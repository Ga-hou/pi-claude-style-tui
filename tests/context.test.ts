import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContextBar, formatContextTokens } from "../extensions/claude-context.ts";

describe("Claude context visualization", () => {
	it("renders full and partial block progress", () => {
		assert.deepEqual(buildContextBar(0.5, 8), { used: "████", free: "░░░░" });
		assert.deepEqual(buildContextBar(0.15625, 8), { used: "█▎", free: "░░░░░░" });
	});

	it("formats context token counts compactly", () => {
		assert.equal(formatContextTokens(999), "999");
		assert.equal(formatContextTokens(1_250), "1.3k");
		assert.equal(formatContextTokens(200_000), "200k");
	});
});
