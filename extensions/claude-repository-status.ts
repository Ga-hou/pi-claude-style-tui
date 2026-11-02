import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GitHubStatus, readGitHubStatus } from "./claude-github-status.ts";

export type StatusExec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
export type GitStatus = { branch: string | null; changedFiles: number; added: number; removed: number };

export function parseGitChanges(status: string, numstat: string): Omit<GitStatus, "branch"> {
	const records = status.split("\0");
	let changedFiles = 0;
	for (let i = 0; i < records.length; i++) {
		const record = records[i]!;
		if (!record) continue;
		changedFiles++;
		if (/^[RC]|^.[RC]/.test(record)) i++; // -z renames/copies carry a second path.
	}
	let added = 0;
	let removed = 0;
	for (const line of numstat.split("\n")) {
		const [plus, minus] = line.split("\t");
		if (/^\d+$/.test(plus ?? "")) added += Number(plus);
		if (/^\d+$/.test(minus ?? "")) removed += Number(minus);
	}
	return { changedFiles, added, removed };
}

export async function readGitStatus(
	exec: StatusExec,
	cwd: string,
	signal: AbortSignal,
): Promise<GitStatus | undefined> {
	const run = async (args: string[]) => {
		const result = await exec("git", args, { cwd, signal, timeout: 4_000 });
		if (result.killed) throw new Error("Git status timed out or was cancelled");
		return result;
	};
	const status = await run(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
	if (status.code !== 0) {
		if (status.code === 128 && /not a git repository/i.test(status.stderr)) return undefined;
		throw new Error(`Git status failed (exit ${status.code})`);
	}
	const branch = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
	if (branch.code !== 0 && branch.code !== 1) throw new Error(`Git branch failed (exit ${branch.code})`);
	const worktree = await run(["diff", "--numstat", "--no-ext-diff"]);
	const staged = await run(["diff", "--cached", "--numstat", "--no-ext-diff"]);
	if (worktree.code !== 0 || staged.code !== 0) throw new Error("Git diff statistics failed");
	return {
		branch: branch.code === 0 ? branch.stdout.trim() : null,
		...parseGitChanges(status.stdout, `${worktree.stdout}\n${staged.stdout}`),
	};
}

/** One in-flight read, no subprocesses on the render path, no updates after disposal. */
export class RepositoryStatus {
	git: GitStatus | undefined;
	error: string | undefined;
	github: GitHubStatus | undefined;
	githubError: string | undefined;
	githubPending = true;
	private lastGitHubAt = 0;
	private readonly githubEnabled: boolean;
	private timer: NodeJS.Timeout | undefined;
	private pending: Promise<void> | undefined;
	private readonly controller = new AbortController();

	private readonly pi: Pick<ExtensionAPI, "exec">;
	private readonly cwd: string;
	private readonly changed: () => void;

	constructor(pi: Pick<ExtensionAPI, "exec">, cwd: string, changed: () => void, githubEnabled = false) {
		this.pi = pi;
		this.cwd = cwd;
		this.changed = changed;
		this.githubEnabled = githubEnabled;
	}

	start(): void {
		void this.refresh();
		this.timer = setInterval(() => {
			void this.refresh();
		}, 5_000);
		this.timer.unref?.();
	}

	refresh(): Promise<void> {
		if (this.controller.signal.aborted) return Promise.resolve();
		if (this.pending) return this.pending;
		this.pending = this.read().finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	private async read(): Promise<void> {
		try {
			const git = await readGitStatus(this.pi.exec.bind(this.pi), this.cwd, this.controller.signal);
			if (this.controller.signal.aborted) return;
			const branchChanged = this.git?.branch !== git?.branch;
			this.git = git;
			this.error = undefined;
			if (branchChanged || !git?.branch) {
				this.github = undefined;
				this.githubError = undefined;
				this.githubPending = Boolean(git?.branch);
			}
			this.changed();
			if (this.githubEnabled && git?.branch && (branchChanged || Date.now() - this.lastGitHubAt >= 60_000)) {
				this.lastGitHubAt = Date.now();
				this.githubPending = true;
				try {
					const github = await readGitHubStatus(
						this.pi.exec.bind(this.pi),
						this.cwd,
						git.branch,
						this.controller.signal,
					);
					if (this.controller.signal.aborted) return;
					this.github = github;
					this.githubError = undefined;
					this.githubPending = false;
				} catch (error) {
					if (this.controller.signal.aborted) return;
					this.github = undefined;
					this.githubError = (error as Error).message;
					this.githubPending = false;
				}
			}
		} catch (error) {
			if (this.controller.signal.aborted) return;
			this.git = undefined;
			this.github = undefined;
			this.githubError = undefined;
			this.githubPending = false;
			this.error = (error as Error).message;
		}
		this.changed();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.controller.abort();
	}
}
