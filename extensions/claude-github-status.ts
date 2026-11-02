import type { StatusExec } from "./claude-repository-status.ts";

export type GitHubStatus = { number: number; draft: boolean; review: string; ci: "pass" | "fail" | "pending" | "none" };

export function githubRepository(remote: string): string | undefined {
	const match =
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
			remote.trim(),
		);
	return match?.[1];
}

export function parsePullRequest(value: unknown): GitHubStatus | undefined {
	if (!Array.isArray(value)) throw new Error("Invalid GitHub PR response");
	if (!value.length) return undefined;
	const pr = value[0];
	if (
		!pr ||
		!Number.isSafeInteger(pr.number) ||
		pr.number <= 0 ||
		typeof pr.isDraft !== "boolean" ||
		!Array.isArray(pr.statusCheckRollup)
	) {
		throw new Error("Invalid GitHub PR fields");
	}
	const checks = pr.statusCheckRollup as Array<{ status?: string; conclusion?: string; state?: string }>;
	const failed = checks.some((check) =>
		["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
			check.conclusion ?? check.state ?? "",
		),
	);
	const pending = checks.some((check) => (check.status ? check.status !== "COMPLETED" : check.state !== "SUCCESS"));
	return {
		number: pr.number,
		draft: pr.isDraft,
		review: ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(pr.reviewDecision)
			? pr.reviewDecision
			: "pending",
		ci: failed ? "fail" : pending ? "pending" : checks.length ? "pass" : "none",
	};
}

export async function readGitHubStatus(
	exec: StatusExec,
	cwd: string,
	branch: string,
	signal: AbortSignal,
): Promise<GitHubStatus | undefined> {
	const origin = await exec("git", ["remote", "get-url", "origin"], { cwd, signal, timeout: 4_000 });
	if (origin.killed) throw new Error("GitHub remote lookup cancelled or timed out");
	if (origin.code !== 0) throw new Error("GitHub origin unavailable");
	const repository = githubRepository(origin.stdout);
	// Never forward non-GitHub remotes or embedded credentials.
	if (!repository) throw new Error("Origin is not a credential-free github.com repository");
	const result = await exec(
		"gh",
		[
			"pr",
			"list",
			"--repo",
			`https://github.com/${repository}`,
			`--head=${branch}`,
			"--state",
			"open",
			"--limit",
			"1",
			"--json",
			"number,isDraft,reviewDecision,statusCheckRollup",
		],
		{ cwd, signal, timeout: 8_000 },
	);
	if (result.killed || result.code !== 0) throw new Error(`GitHub status unavailable (exit ${result.code})`);
	return parsePullRequest(JSON.parse(result.stdout));
}
