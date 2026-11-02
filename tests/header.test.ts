import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { PiStartupHeader } from "../extensions/claude-header.ts";

it("skips startup animation in reduced motion and stops an active animation immediately", (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const pi = { getThinkingLevel: () => "medium" } as unknown as ExtensionAPI;
	const ctx = {
		cwd: "/tmp/project",
		ui: { theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } },
	} as unknown as ExtensionContext;
	let renders = 0;
	const tui = { requestRender: () => renders++ } as unknown as TUI;
	const still = new PiStartupHeader(pi, ctx, tui, true);
	const expected = still.render(80);
	t.mock.timers.tick(1_000);
	assert.equal(renders, 0);
	assert.deepEqual(still.render(80), expected);
	const animated = new PiStartupHeader(pi, ctx, tui);
	t.mock.timers.tick(120);
	assert.equal(renders, 1);
	animated.setReducedMotion(true);
	assert.deepEqual(animated.render(80), expected);
	const stoppedRenders = renders;
	animated.setReducedMotion(false);
	t.mock.timers.tick(1_000);
	assert.equal(renders, stoppedRenders);
	animated.dispose();
	still.dispose();
});
