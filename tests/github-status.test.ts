import assert from "node:assert/strict";
import { it } from "node:test";
import { githubRepository, parsePullRequest, readGitHubStatus } from "../extensions/claude-github-status.ts";
import type { StatusExec } from "../extensions/claude-repository-status.ts";

it("only accepts credential-free github.com remotes", () => {
	for (const remote of [
		"https://github.com/owner/repo.git",
		"git@github.com:owner/repo.git",
		"ssh://git@github.com/owner/repo.git",
	]) {
		assert.equal(githubRepository(remote), "owner/repo");
	}
	for (const remote of [
		"https://token@github.com/owner/repo",
		"https://github.com.evil/owner/repo",
		"https://gitlab.com/owner/repo",
		"https://github.com/o/r?token=secret",
	]) {
		assert.equal(githubRepository(remote), undefined);
	}
});

it("distinguishes pending, failing, passing, draft and absent PRs", () => {
	const pr = {
		number: 12,
		isDraft: false,
		reviewDecision: "APPROVED",
		statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
	};
	assert.deepEqual(parsePullRequest([pr]), { number: 12, draft: false, review: "APPROVED", ci: "pass" });
	assert.equal(parsePullRequest([{ ...pr, isDraft: true, statusCheckRollup: [{ state: "FAILURE" }] }])!.ci, "fail");
	assert.equal(parsePullRequest([{ ...pr, statusCheckRollup: [{ status: "IN_PROGRESS" }] }])!.ci, "pending");
	assert.equal(parsePullRequest([{ ...pr, statusCheckRollup: [] }])!.ci, "none");
	assert.equal(parsePullRequest([]), undefined);
	assert.throws(() => parsePullRequest({}));
	assert.throws(() => parsePullRequest([{ number: "12" }]));
});

it("pins GitHub host/repository, parameterizes branch names and surfaces auth failures", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const exec: StatusExec = async (command, args) => {
		calls.push({ command, args });
		return { code: 0, killed: false, stdout: command === "git" ? "git@github.com:owner/repo.git\n" : "[]", stderr: "" };
	};
	const signal = new AbortController().signal;
	assert.equal(await readGitHubStatus(exec, "/tmp", "--odd;branch", signal), undefined);
	assert.equal(calls[1]!.command, "gh");
	assert.ok(calls[1]!.args.includes("--head=--odd;branch"));
	assert.ok(calls[1]!.args.includes("https://github.com/owner/repo"));
	const unauthenticated: StatusExec = async (command, args, options) =>
		command === "git"
			? exec(command, args, options)
			: { code: 4, killed: false, stdout: "", stderr: "private auth details" };
	await assert.rejects(readGitHubStatus(unauthenticated, "/tmp", "main", signal), /exit 4/);
	let forwarded = false;
	const nonGithub: StatusExec = async (command) => {
		if (command === "gh") forwarded = true;
		return { code: 0, killed: false, stdout: "https://gitlab.com/o/r", stderr: "" };
	};
	await assert.rejects(readGitHubStatus(nonGithub, "/tmp", "main", signal), /credential-free/);
	assert.equal(forwarded, false);
});
