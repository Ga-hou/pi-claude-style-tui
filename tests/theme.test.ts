import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const theme = JSON.parse(await readFile(new URL("../themes/claude-code-dark.json", import.meta.url), "utf8")) as {
	vars: Record<string, string>;
	colors: Record<string, string>;
};

describe("Claude dark theme colors", () => {
	it("maps Pi semantics to Claude's exact dark palette", () => {
		assert.equal(theme.vars.accent, "#d77757");
		assert.equal(theme.vars.claudeShimmer, "#eb9f7f");
		assert.equal(theme.vars.gray, "#999999");
		assert.equal(theme.vars.darkGray, "#505050");
		assert.equal(theme.vars.bashBorder, "#fd5db1");
		assert.equal(theme.colors.accent, "accent");
		assert.equal(theme.colors.thinkingXhigh, "claudeShimmer");
		assert.equal(theme.colors.muted, "gray");
		assert.equal(theme.colors.dim, "darkGray");
		assert.equal(theme.colors.customMessageLabel, "blue");
		assert.equal(theme.colors.bashMode, "bashBorder");
	});

	it("uses Claude's permission blue-purple for inline code", () => {
		assert.equal(theme.vars.blue, "#b1b9f9");
		assert.equal(theme.colors.mdCode, "blue");
	});

	it("keeps list bullets in the normal text color", () => {
		assert.equal(theme.colors.mdListBullet, "text");
	});
});
