import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const theme = JSON.parse(
	await readFile(new URL("../themes/claude-code-dark.json", import.meta.url), "utf8"),
) as {
	vars: Record<string, string>;
	colors: Record<string, string>;
};

describe("Claude dark Markdown colors", () => {
	it("uses Claude's permission blue-purple for inline code", () => {
		assert.equal(theme.vars.blue, "#b1b9f9");
		assert.equal(theme.colors.mdCode, "blue");
	});

	it("keeps list bullets in the normal text color", () => {
		assert.equal(theme.colors.mdListBullet, "text");
	});
});
