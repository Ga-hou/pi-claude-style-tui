import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	collectStatusLineUsage,
	normalizeStatusLineItems,
	renderStatusLine,
	showStatusLineSetup,
} from "../extensions/claude-status-line.ts";

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => text,
} as unknown as ExtensionContext["ui"]["theme"];

function source(percent: number | null = 50) {
	return {
		cwd: "/tmp/project",
		model: { id: "test-model", provider: "test", contextWindow: 100_000, reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			isUsingOAuth: () => false,
			getProvider: () => undefined,
		},
		getContextUsage: () => ({ tokens: 50_000, contextWindow: 100_000, percent }),
		sessionManager: {
			getSessionName: () => "Status work",
			getSessionId: () => "session-123",
			getSessionFile: () => "/tmp/session.jsonl",
			getEntries: () => [{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 50,
						output: 10,
						cacheRead: 50,
						cacheWrite: 0,
						cost: { total: 0.125 },
					},
				},
			}],
		},
	} as unknown as Pick<
		ExtensionContext,
		"cwd" | "model" | "modelRegistry" | "sessionManager" | "thinkingLevel" | "getContextUsage"
	>;
}

describe("Claude status line", () => {
	it("normalizes configured items while preserving explicit order and hidden-all", () => {
		assert.deepEqual(normalizeStatusLineItems(["cost", "model", "cost", "unknown"]), ["cost", "model"]);
		assert.deepEqual(normalizeStatusLineItems([]), []);
	});

	it("uses Pi's cumulative cache and cost accounting buckets", () => {
		assert.deepEqual(collectStatusLineUsage([
			{
				type: "message",
				message: {
					role: "assistant",
					usage: { input: 25, cacheRead: 75, cacheWrite: 0, cost: { total: 0.1 } },
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					usage: { input: 5, output: 2, cacheRead: 10, cacheWrite: 20, cost: { total: 0.02 } },
				},
			},
			{ type: "compaction", usage: { input: 3, output: 1, cacheRead: 5, cacheWrite: 0, cost: { total: 0.03 } } },
			{ type: "custom", customType: "claude-run-metrics", data: { durationMs: 65_000 } },
		]), {
			input: 33,
			output: 3,
			cacheRead: 90,
			cacheWrite: 20,
			cost: 0.15000000000000002,
			durationMs: 65_000,
			latestCacheHitRate: 75,
		});
	});

	it("renders configured order, cache, cost, and Pi context thresholds", () => {
		const rendered = renderStatusLine(["cost", "cache", "context", "model", "directory"], source(91), theme, "main");
		assert.ok(rendered.indexOf("$0.125") < rendered.indexOf("R50 CH50.0%"));
		assert.ok(rendered.indexOf("R50 CH50.0%") < rendered.indexOf("ctx 91%/100k"));
		assert.match(rendered, /test-model • medium/);
		assert.match(rendered, /<error>ctx 91%\/100k<\/error>/);
		assert.match(renderStatusLine(["context"], source(70), theme), /<warning>ctx 70%\/100k<\/warning>/);
		assert.match(renderStatusLine(["context"], source(90), theme), /<error>ctx 90%\/100k<\/error>/);
		assert.match(renderStatusLine(["context"], source(null), theme), /<dim>ctx \?\/100k<\/dim>/);
		assert.match(
			renderStatusLine(
				["session-name", "session-id", "transcript-path", "context-remaining", "context-window", "input-tokens", "output-tokens", "version"],
				source(25),
				theme,
			),
			/Status work.*session-123.*session\.jsonl.*ctx 75% left.*100k window.*↑50.*↓10.*v/,
		);
	});

	it("reorders enabled items with left/right like Codex", async () => {
		let component: { handleInput(data: string): void } | undefined;
		const ctx = {
			...source(),
			mode: "tui",
			ui: { theme },
		} as unknown as ExtensionCommandContext;

		let saved: unknown;
		(ctx.ui as any).custom = async (factory: any) => {
			component = factory({ requestRender() {} }, theme, {}, (value: unknown) => { saved = value; });
			component!.handleInput("\u001b[C");
			component!.handleInput("\r");
			return saved;
		};
		assert.deepEqual(await showStatusLineSetup(ctx, ["model", "context"]), ["context", "model"]);
	});
});
