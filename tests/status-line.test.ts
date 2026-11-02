import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	collectStatusLineUsage,
	layoutStatusLine,
	normalizeStatusLineItems,
	renderStatusLine,
	StatusLineUsageCache,
	showStatusLineSetup,
} from "../extensions/claude-status-line.ts";

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => text,
} as unknown as ExtensionContext["ui"]["theme"];

function source(percent: number | null = 50) {
	return {
		cwd: "/tmp/project",
		model: {
			id: "test-model",
			provider: "test",
			contextWindow: 100_000,
			reasoning: true,
		},
		thinkingLevel: "medium",
		modelRegistry: {
			isUsingOAuth: () => false,
			getProvider: () => undefined,
		},
		getContextUsage: () => ({
			tokens: 50_000,
			contextWindow: 100_000,
			percent,
		}),
		sessionManager: {
			getSessionName: () => "Status work",
			getSessionId: () => "session-123",
			getSessionFile: () => "/tmp/session.jsonl",
			getEntries: () => [
				{
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
				},
			],
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
		assert.deepEqual(
			collectStatusLineUsage([
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 25,
							cacheRead: 75,
							cacheWrite: 0,
							cost: { total: 0.1 },
						},
					},
				},
				{
					type: "message",
					message: {
						role: "toolResult",
						usage: {
							input: 5,
							output: 2,
							cacheRead: 10,
							cacheWrite: 20,
							cost: { total: 0.02 },
						},
					},
				},
				{
					type: "compaction",
					usage: {
						input: 3,
						output: 1,
						cacheRead: 5,
						cacheWrite: 0,
						cost: { total: 0.03 },
					},
				},
				{
					type: "custom",
					customType: "claude-run-metrics",
					data: { durationMs: 65_000 },
				},
			]),
			{
				input: 33,
				output: 3,
				cacheRead: 90,
				cacheWrite: 20,
				cost: 0.15000000000000002,
				durationMs: 65_000,
				latestCacheHitRate: 75,
			},
		);
	});

	it("renders configured order, cache, cost, and Pi context thresholds", () => {
		const rendered = renderStatusLine(["cost", "cache", "context", "model", "directory"], source(91), theme, "main");
		assert.ok(rendered.indexOf("$0.125") < rendered.indexOf("R50 CH50.0%"));
		assert.ok(rendered.indexOf("R50 CH50.0%") < rendered.indexOf("ctx 91%/100k"));
		assert.match(rendered, /test-model • medium/);
		assert.match(rendered, /<error>ctx 91%\/100k<\/error>/);
		for (const percent of [0, 50, 70]) {
			assert.match(
				renderStatusLine(["context"], source(percent), theme),
				new RegExp(`<dim>ctx ${percent}%/100k</dim>`),
			);
		}
		for (const percent of [71, 90]) {
			assert.match(
				renderStatusLine(["context"], source(percent), theme),
				new RegExp(`<warning>ctx ${percent}%/100k</warning>`),
			);
		}
		assert.match(renderStatusLine(["context"], source(100), theme), /<error>ctx 100%\/100k<\/error>/);
		assert.match(renderStatusLine(["context"], source(null), theme), /<dim>ctx \?\/100k<\/dim>/);
		assert.match(
			renderStatusLine(
				[
					"session-name",
					"session-id",
					"transcript-path",
					"context-remaining",
					"context-window",
					"input-tokens",
					"output-tokens",
					"version",
				],
				source(25),
				theme,
			),
			/Status work.*session-123.*session\.jsonl.*ctx 75% left.*100k window.*↑50.*↓10.*v/,
		);
	});

	it("caches 10k entries across repaints and counts only new entries across branches", () => {
		const entries = Array.from({ length: 10_000 }, (_, i) => ({
			id: String(i),
			parentId: i ? String(i - 1) : null,
			type: "message",
			message: { role: "assistant", usage: { output: 1 } },
		}));
		let leaf = entries.at(-1)!.id;
		let session = "first";
		let scans = 0;
		let lookups = 0;
		const manager = {
			getSessionId: () => session,
			getLeafId: () => leaf,
			getEntries: () => {
				scans++;
				return entries;
			},
			getEntry: (id: string) => {
				lookups++;
				return entries[Number(id)];
			},
		} as unknown as ExtensionContext["sessionManager"];
		const cache = new StatusLineUsageCache();
		for (let i = 0; i < 1_000; i++) assert.equal(cache.get(manager).output, 10_000);
		assert.equal(scans, 1);
		assert.equal(lookups, 0);
		entries.push({ ...entries[0]!, id: "10000", parentId: leaf });
		leaf = "10000";
		assert.equal(cache.get(manager).output, 10_001);
		assert.equal(lookups, 1);
		leaf = "5";
		assert.equal(cache.get(manager).output, 10_001);
		entries.push({ ...entries[0]!, id: "10001", parentId: leaf });
		leaf = "10001";
		assert.equal(cache.get(manager).output, 10_002);
		assert.equal(scans, 1);
		session = "second";
		entries.splice(0);
		assert.equal(cache.get(manager).output, 0);
		assert.equal(scans, 2);
	});

	it("wraps complete fields and prioritizes context, model and cost in narrow terminals", () => {
		const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
		const segments = [
			{ id: "model" as const, text: "model high" },
			{ id: "context" as const, text: "ctx 71%" },
			{ id: "directory" as const, text: "~/very/long/workspace/path" },
			{ id: "cache" as const, text: "R100k CH90%" },
			{ id: "cost" as const, text: "$0.125" },
		];
		assert.deepEqual(layoutStatusLine(segments, 120, plainTheme), [segments.map((s) => s.text).join(" | ")]);
		const narrow = layoutStatusLine(segments, 24, plainTheme);
		assert.ok(narrow.length <= 2);
		assert.match(narrow.join("\n"), /model high.*ctx 71%/);
		assert.match(narrow.join("\n"), /\$0\.125/);
		assert.ok(narrow.every((line) => visibleWidth(line) <= 24));
		assert.deepEqual(layoutStatusLine(segments, 0, plainTheme), []);
		assert.deepEqual(layoutStatusLine([], 24, plainTheme), []);
		assert.ok(layoutStatusLine(segments, 1, plainTheme).every((line) => visibleWidth(line) <= 1));
		for (const width of [1, 8, 20, 40, 80]) {
			const unicode = [{ id: "model" as const, text: "\x1b[31m模型👩‍💻é high\x1b[0m" }, ...segments];
			assert.ok(layoutStatusLine(unicode, width, plainTheme).every((line) => visibleWidth(line) <= width));
		}
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
			component = factory({ requestRender() {} }, theme, {}, (value: unknown) => {
				saved = value;
			});
			component!.handleInput("\u001b[C");
			component!.handleInput("\r");
			return saved;
		};
		assert.deepEqual(await showStatusLineSetup(ctx, ["model", "context"]), ["context", "model"]);
	});
});
