import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildContextBar, formatContextTokens, showClaudeContext } from "../extensions/claude-context.ts";

describe("Claude context visualization", () => {
	it("renders full and partial block progress", () => {
		assert.deepEqual(buildContextBar(0.5, 8), { used: "████", free: "░░░░" });
		assert.deepEqual(buildContextBar(0.15625, 8), { used: "█▎", free: "░░░░░░" });
	});

	it("reads fresh context on each render and stops refreshing when closed", async (t) => {
		t.mock.timers.enable({ apis: ["setInterval"] });
		let percent = 10;
		let renders = 0;
		const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
		const ctx = {
			mode: "tui",
			getContextUsage: () => ({ percent, tokens: percent * 1_000, contextWindow: 100_000 }),
			ui: {
				custom: async (factory: any) => {
					const component = factory({ requestRender: () => renders++ }, theme, {}, () => {});
					assert.match(component.render(80).join("\n"), /10% used/);
					percent = 75;
					t.mock.timers.tick(1_000);
					assert.match(component.render(80).join("\n"), /75% used/);
				},
			},
		} as unknown as ExtensionCommandContext;
		await showClaudeContext(ctx);
		assert.equal(renders, 1);
		t.mock.timers.tick(2_000);
		assert.equal(renders, 1);
	});

	it("formats context token counts compactly", () => {
		assert.equal(formatContextTokens(999), "999");
		assert.equal(formatContextTokens(1_250), "1.3k");
		assert.equal(formatContextTokens(200_000), "200k");
	});
});
