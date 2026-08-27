import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClaudePromptStyle } from "../extensions/claude-editor.ts";

describe("Claude editor prompt state", () => {
	it("dims while loading and uses the bash color for bang commands", () => {
		assert.deepEqual(getClaudePromptStyle("hello", false), { marker: "❯", color: "text" });
		assert.deepEqual(getClaudePromptStyle("hello", true), { marker: "❯", color: "dim" });
		assert.deepEqual(getClaudePromptStyle("  !pwd", true), { marker: "❯", color: "bashMode" });
	});
});
