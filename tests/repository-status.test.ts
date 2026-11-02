import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import {
	parseGitChanges,
	RepositoryStatus,
	readGitStatus,
	type StatusExec,
} from "../extensions/claude-repository-status.ts";

const execFileAsync = promisify(execFile);
const exec: StatusExec = async (command, args, options) => {
	try {
		const result = await execFileAsync(command, args, {
			cwd: options?.cwd,
			signal: options?.signal,
			timeout: options?.timeout,
		});
		return { ...result, code: 0, killed: false };
	} catch (error) {
		const failure = error as { code: number; stdout: string; stderr: string; killed?: boolean };
		if (typeof failure.code !== "number") throw error;
		return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr, killed: failure.killed ?? false };
	}
};

it("parses NUL paths, renames and binary diffs without counting rename sources", () => {
	assert.deepEqual(parseGitChanges(" M tab\tname\0R  new\0old\0?? new\nfile\0", "2\t3\tx\n-\t-\tbinary"), {
		changedFiles: 3,
		added: 2,
		removed: 3,
	});
});

it("reads a real unborn repo, staged and working changes, and non-repository state", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "claude-tui-git-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const signal = new AbortController().signal;
	assert.equal(await readGitStatus(exec, dir, signal), undefined);
	await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	assert.deepEqual(await readGitStatus(exec, dir, signal), { branch: "main", changedFiles: 0, added: 0, removed: 0 });
	await writeFile(join(dir, "file.txt"), "one\ntwo\n");
	await execFileAsync("git", ["add", "file.txt"], { cwd: dir });
	assert.deepEqual(await readGitStatus(exec, dir, signal), { branch: "main", changedFiles: 1, added: 2, removed: 0 });
	await writeFile(join(dir, "file.txt"), "one\nthree\n");
	assert.deepEqual(await readGitStatus(exec, dir, signal), { branch: "main", changedFiles: 1, added: 3, removed: 1 });
});

it("limits GitHub reads to once a minute, refreshes branch changes, and stays offline by default", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	let branch = "main";
	let requests = 0;
	const source: StatusExec = async (command, args) => {
		let stdout = "";
		if (args[0] === "symbolic-ref") stdout = branch;
		if (args[0] === "remote") stdout = "https://github.com/owner/repo.git";
		if (command === "gh") {
			requests++;
			stdout = "[]";
		}
		return { code: 0, stdout, stderr: "", killed: false };
	};
	const enabled = new RepositoryStatus({ exec: source }, "/tmp", () => {}, true);
	await enabled.refresh();
	assert.equal(requests, 1);
	for (let i = 0; i < 11; i++) {
		t.mock.timers.tick(5_000);
		await enabled.refresh();
	}
	assert.equal(requests, 1);
	t.mock.timers.tick(5_000);
	await enabled.refresh();
	assert.equal(requests, 2);
	branch = "feature";
	await enabled.refresh();
	assert.equal(requests, 3);
	enabled.dispose();
	const disabled = new RepositoryStatus({ exec: source }, "/tmp", () => {});
	await disabled.refresh();
	assert.equal(requests, 3);
	disabled.dispose();
});

it("deduplicates concurrent reads, reports failures, and suppresses late results after dispose", async () => {
	let calls = 0;
	let release!: () => void;
	let changes = 0;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const repository = new RepositoryStatus(
		{
			exec: async () => {
				calls++;
				await pending;
				return { code: 1, stdout: "", stderr: "failure", killed: false };
			},
		},
		"/tmp",
		() => changes++,
	);
	const first = repository.refresh();
	assert.equal(repository.refresh(), first);
	assert.equal(calls, 1);
	repository.dispose();
	release();
	await first;
	assert.equal(changes, 0);
	const failed = new RepositoryStatus(
		{
			exec: async () => {
				throw new Error("git missing");
			},
		},
		"/tmp",
		() => changes++,
	);
	await failed.refresh();
	assert.equal(failed.error, "git missing");
	assert.equal(changes, 1);
	failed.dispose();
});
