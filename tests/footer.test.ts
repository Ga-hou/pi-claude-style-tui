import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyClaudeFooter, githubStatusFields } from "../extensions/claude-footer.ts";
import { RepositoryStatus } from "../extensions/claude-repository-status.ts";

it("does not present loading or unavailable PR data as an absent PR", () => {
	const repository = new RepositoryStatus(
		{
			exec: async () => {
				throw new Error("unused");
			},
		},
		"/tmp",
		() => {},
	);
	assert.match(githubStatusFields(repository, false).pr, /disabled/);
	assert.match(githubStatusFields(repository, true).pr, /loading/);
	repository.githubPending = false;
	assert.match(githubStatusFields(repository, true).pr, /unavailable/);
	repository.git = { branch: "main", changedFiles: 0, added: 0, removed: 0 };
	assert.equal(githubStatusFields(repository, true).pr, "PR none");
	repository.githubError = "auth unavailable";
	assert.match(githubStatusFields(repository, true).pr, /unavailable/);
	repository.dispose();
});

it("refreshes model, effort, usage and statuses while idle and disposes resources", (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let renders = 0;
	let unsubscribed = false;
	let footer: any;
	let model = "first";
	let effort = "medium";
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const ctx = {
		cwd: "/tmp/project",
		get model() {
			return { id: model, reasoning: true };
		},
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getSessionId: () => "one",
			getLeafId: () => null,
			getEntries: () => [],
			getSessionName: () => undefined,
			getSessionFile: () => undefined,
		},
		getContextUsage: () => ({ percent: 50, contextWindow: 100_000 }),
		ui: {
			setFooter(factory: any) {
				footer = factory({ requestRender: () => renders++ }, theme, {
					getGitBranch: () => "main",
					getExtensionStatuses: () => new Map([["usage", "5h 20% · 7d 30%"]]),
					onBranchChange: () => () => {
						unsubscribed = true;
					},
				});
			},
		},
	} as unknown as ExtensionContext;
	const pi = { getThinkingLevel: () => effort } as unknown as ExtensionAPI;
	const shutdown = applyClaudeFooter(pi, ctx, ["model", "context", "quota", "cache-expiry"]);
	assert.match(footer.render(80).join("\n"), /first • medium/);
	model = "second";
	effort = "high";
	t.mock.timers.tick(1_000);
	assert.equal(renders, 1);
	assert.match(footer.render(80).join("\n"), /second • high/);
	const rendered = footer.render(160).join("\n");
	assert.match(rendered, /5h 20% · 7d 30%/);
	assert.equal(rendered.split("5h 20%").length - 1, 1);
	assert.match(rendered, /cache expiry unavailable/);
	shutdown();
	footer.dispose();
	t.mock.timers.tick(3_000);
	assert.equal(renders, 1);
	assert.equal(unsubscribed, true);
});
