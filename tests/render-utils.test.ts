import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addEditorPromptMarker,
	addUserPromptMarker,
	applyStraightEditorBorders,
	findBottomBorderIndex,
	formatAnimatedWorkingMessage,
	formatCwd,
	formatDuration,
	formatModelLabel,
	formatRunSummary,
	formatThinkingLabel,
	formatTokenCount,
	formatWorkingMessage,
	getClaudeSpinnerFrames,
	getStreamDeltaLength,
	highlightSlashCommands,
	isEditorBorderLine,
	PI_WORKING_VERBS,
	pickCompletionVerb,
	pickWorkingVerb,
	stripAnsi,
	TURN_COMPLETION_VERBS,
} from "../extensions/render-utils.ts";

describe("formatCwd", () => {
	it("replaces HOME prefix with ~", () => {
		assert.equal(formatCwd("/Users/me/Workspace/mypi", "/Users/me"), "~/Workspace/mypi");
	});

	it("leaves paths outside home unchanged", () => {
		assert.equal(formatCwd("/tmp/project", "/Users/me"), "/tmp/project");
	});
});

describe("formatModelLabel", () => {
	it("formats provider/id when both exist", () => {
		assert.equal(formatModelLabel({ provider: "openai-codex", id: "gpt-5.5" }), "openai-codex/gpt-5.5");
	});

	it("falls back to id or default", () => {
		assert.equal(formatModelLabel({ id: "gpt-5.5" }), "gpt-5.5");
		assert.equal(formatModelLabel(undefined), "Default model");
	});
});

describe("formatThinkingLabel", () => {
	it("keeps off explicit", () => {
		assert.equal(formatThinkingLabel("off"), "off");
		assert.equal(formatThinkingLabel("high"), "high");
	});
});

describe("run metrics formatting", () => {
	it("formats durations at second, minute, and hour boundaries", () => {
		assert.equal(formatDuration(999), "0s");
		assert.equal(formatDuration(65_000), "1m 5s");
		assert.equal(formatDuration(3_665_000), "1h 1m 5s");
	});

	it("counts every Claude-style generated-content delta", () => {
		assert.equal(getStreamDeltaLength({ type: "text_delta", delta: "hello" }), 5);
		assert.equal(getStreamDeltaLength({ type: "thinking_delta", delta: "reasoning" }), 9);
		assert.equal(getStreamDeltaLength({ type: "toolcall_delta", delta: '{"path":' }), 8);
		assert.equal(getStreamDeltaLength({ type: "done" }), 0);
	});

	it("matches Claude's delayed active-turn stats", () => {
		assert.equal(formatTokenCount(999), "999");
		assert.equal(formatTokenCount(1_250), "1.3k");
		assert.equal(formatTokenCount(12_500), "13k");
		assert.equal(formatWorkingMessage("Crafting", 30_000, 5_000), "Crafting…");
		assert.equal(formatWorkingMessage("Crafting", 30_001, 0), "Crafting… (30s)");
		assert.equal(formatWorkingMessage("Crafting", 30_001, 5_000), "Crafting… (30s · ↓ 1.3k tokens)");
		assert.equal(formatWorkingMessage("Crafting", 999, 40, true), "Crafting… (0s · ↓ 10 tokens)");
		assert.equal(formatWorkingMessage("Crafting", 999, 40, true, undefined, "up"), "Crafting… (0s · ↑ 10 tokens)");
		assert.equal(formatWorkingMessage("Crafting", 5_000, 0, false, "xhigh"), "Crafting… (thinking with xhigh effort)");
		assert.equal(
			formatWorkingMessage("Crafting", 30_001, 5_000, false, "xhigh"),
			"Crafting… (30s · ↓ 1.3k tokens · thinking with xhigh effort)",
		);
	});

	it("shows only the completed turn duration", () => {
		assert.equal(formatRunSummary(65_000), "Worked for 1m 5s");
		assert.equal(formatRunSummary(65_000, "Brewed"), "Brewed for 1m 5s");
	});
});

describe("Claude working color animation", () => {
	it("uses theme semantics for Claude, shimmer, and inactive text", () => {
		const calls: Array<{ color: string; text: string }> = [];
		const theme: Parameters<typeof formatAnimatedWorkingMessage>[2] = {
			fg(color, text) {
				calls.push({ color, text });
				return `<${color}>${text}</${color}>`;
			},
		};
		const message = formatAnimatedWorkingMessage("Precipitating… (3s)", 3_000, theme);
		assert.equal(stripAnsi(message), message);
		assert.deepEqual(
			calls.map(({ color }) => color),
			["accent", "thinkingXhigh", "accent", "muted"],
		);
		assert.equal(calls.map(({ text }) => text).join(""), "Precipitating… (3s)");
	});
});

describe("Claude working glyph animation", () => {
	it("mirrors Claude's macOS frame sequence", () => {
		assert.deepEqual(getClaudeSpinnerFrames("xterm-256color", "darwin"), [
			"·",
			"✢",
			"✳",
			"✶",
			"✻",
			"✽",
			"✽",
			"✻",
			"✶",
			"✳",
			"✢",
			"·",
		]);
	});

	it("uses Claude's Ghostty-safe final glyph", () => {
		assert.deepEqual(getClaudeSpinnerFrames("xterm-ghostty", "darwin"), [
			"·",
			"✢",
			"✳",
			"✶",
			"✻",
			"*",
			"*",
			"✻",
			"✶",
			"✳",
			"✢",
			"·",
		]);
	});
});

describe("Claude verb sampling", () => {
	it("samples a spinner verb from Claude's full list", () => {
		assert.equal(PI_WORKING_VERBS.length, 187);
		assert.equal(
			pickWorkingVerb(() => 0),
			PI_WORKING_VERBS[0],
		);
		assert.equal(
			pickWorkingVerb(() => 0.999),
			PI_WORKING_VERBS.at(-1),
		);
	});

	it("samples completion verbs from Claude's eight past-tense options", () => {
		assert.deepEqual(TURN_COMPLETION_VERBS, [
			"Baked",
			"Brewed",
			"Churned",
			"Cogitated",
			"Cooked",
			"Crunched",
			"Sautéed",
			"Worked",
		]);
		assert.equal(
			pickCompletionVerb(() => 0),
			"Baked",
		);
		assert.equal(
			pickCompletionVerb(() => 0.999),
			"Worked",
		);
	});
});

describe("editor border detection", () => {
	it("recognizes plain and scroll indicator borders", () => {
		assert.equal(isEditorBorderLine("─".repeat(40)), true);
		assert.equal(isEditorBorderLine(`\x1b[38;2;1;2;3m${"─".repeat(40)}\x1b[39m`), true);
		assert.equal(isEditorBorderLine("─── ↑ 2 more ──────────"), true);
		assert.equal(isEditorBorderLine("─── ↓ 5 more ──────────"), true);
	});

	it("rejects content and autocomplete-style rows", () => {
		assert.equal(isEditorBorderLine(" hello world"), false);
		assert.equal(isEditorBorderLine(" \x1b[7mselected item\x1b[0m"), false);
		assert.equal(isEditorBorderLine(""), false);
	});

	it("finds the bottom border before autocomplete rows", () => {
		const lines = ["─".repeat(20), " content line", "─── ↓ 1 more ───────", " /model", " /compact"];
		assert.equal(findBottomBorderIndex(lines), 2);
	});

	it("falls back to the last line when no border is found", () => {
		assert.equal(findBottomBorderIndex(["only", "content"]), 1);
	});
});

describe("addUserPromptMarker", () => {
	it("prefixes user markdown exactly once", () => {
		assert.equal(addUserPromptMarker("hello"), "❯ hello");
		assert.equal(addUserPromptMarker("hello", "styled-pointer"), "styled-pointer hello");
		assert.equal(addUserPromptMarker("❯ hello"), "❯ hello");
	});
});

describe("highlightSlashCommands", () => {
	it("uses Claude suggestion blue semantics only for valid commands", () => {
		const lines = ["─".repeat(20), "  /model opus /unknown", "─".repeat(20), "  /model suggestion"];
		assert.deepEqual(
			highlightSlashCommands(lines, new Set(["model"]), (text) => `<blue>${text}</blue>`),
			["─".repeat(20), "  <blue>/model</blue> opus /unknown", "─".repeat(20), "  /model suggestion"],
		);
	});

	it("preserves cursor ANSI inside the highlighted command", () => {
		const command = "  /\x1b[7mm\x1b[27model";
		const result = highlightSlashCommands(
			["─".repeat(20), command, "─".repeat(20)],
			new Set(["model"]),
			(text) => `<blue>${text}</blue>`,
		);
		assert.equal(result[1], `  <blue>/\x1b[7mm\x1b[27model</blue>`);
	});
});

describe("addEditorPromptMarker", () => {
	it("replaces two padding cells on the first content row", () => {
		const lines = ["─".repeat(20), "  typed text", "─".repeat(20)];
		assert.deepEqual(addEditorPromptMarker(lines, "❯"), ["─".repeat(20), "❯ typed text", "─".repeat(20)]);
	});

	it("does not prefix autocomplete rows below the bottom border", () => {
		const lines = ["─".repeat(20), "  typed text", "─".repeat(20), "  /model"];
		const result = addEditorPromptMarker(lines, "❯");
		assert.equal(result[1], "❯ typed text");
		assert.equal(result[3], "  /model");
	});
});

describe("applyStraightEditorBorders", () => {
	it("uses full-width straight separators and preserves content", () => {
		const width = 24;
		const lines = ["─".repeat(width), " typed text", "─".repeat(width)];
		const result = applyStraightEditorBorders(lines, width, (s) => s);
		assert.equal(stripAnsi(result[0]!), "─".repeat(width));
		assert.equal(stripAnsi(result[1]!), " typed text".padEnd(width));
		assert.equal(stripAnsi(result[2]!), "─".repeat(width));
	});

	it("leaves autocomplete rows below the bottom separator", () => {
		const width = 24;
		const lines = ["─".repeat(width), " typed text", "─".repeat(width), " /model"];
		const result = applyStraightEditorBorders(lines, width, (s) => s);
		assert.equal(stripAnsi(result[2]!), "─".repeat(width));
		assert.equal(stripAnsi(result[3]!), " /model".padEnd(width));
	});
});
