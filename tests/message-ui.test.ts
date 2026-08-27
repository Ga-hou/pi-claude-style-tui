import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	addAssistantResponseMarker,
	bashProgressSummary,
	editSummary,
	fileHyperlink,
	formatToolPath,
	registerClaudeToolRenderers,
	writeSummary,
} from "../extensions/claude-message-ui.ts";
import { stripAnsi } from "../extensions/render-utils.ts";

describe("assistant response marker", () => {
	it("prefixes ordinary prose exactly once", () => {
		assert.equal(addAssistantResponseMarker("hello"), "● hello");
		assert.equal(addAssistantResponseMarker("● hello"), "● hello");
	});

	it("does not break block-level Markdown", () => {
		for (const markdown of ["# Heading", "- item", "1. item", "> quote", "```ts\nconst x = 1;\n```", "| a | b |"]) {
			assert.equal(addAssistantResponseMarker(markdown), markdown);
		}
	});
});

describe("Claude tool details", () => {
	it("uses cwd-relative display paths and OSC 8 file links", () => {
		assert.equal(formatToolPath("/tmp/project/src/index.ts", "/tmp/project"), "src/index.ts");
		assert.equal(
			fileHyperlink("src/index.ts", "/tmp/project", "src/index.ts"),
			"\x1b]8;;file:///tmp/project/src/index.ts\x07src/index.ts\x1b]8;;\x07",
		);
	});

	it("formats semantic edit, write, and bash summaries", () => {
		assert.equal(editSummary({ patch: "--- a/x\n+++ b/x\n-old\n+new\n+extra" }), "Added 2 lines, removed 1 line");
		assert.equal(writeSummary("one\ntwo\n"), "Wrote 2 lines");
		assert.equal(bashProgressSummary("one\ntwo", 2_500), "Running… (2s · 2 lines)");
	});
});

describe("compact built-in tool renderers", () => {
	it("overrides only tools still owned by Pi", () => {
		const registered: Array<Record<string, any>> = [];
		const api = {
			getAllTools: () => [
				{ name: "read", sourceInfo: { source: "builtin" } },
				{ name: "bash", sourceInfo: { source: "builtin" } },
				{ name: "grep", sourceInfo: { source: "builtin" } },
				{ name: "edit", sourceInfo: { source: "ssh-extension" } },
			],
			registerTool: (tool: Record<string, any>) => registered.push(tool),
		} as unknown as ExtensionAPI;

		registerClaudeToolRenderers(api, "/tmp/project");

		assert.deepEqual(
			registered.map((tool) => tool.name),
			["read", "bash", "grep"],
		);
		assert.ok(registered.every((tool) => tool.renderShell === "self"));

		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		} as unknown as Theme;
		const call = registered[0]!.renderCall({ path: "src/index.ts" }, theme, {
			executionStarted: true,
			isError: false,
			isPartial: false,
		});
		const rendered = call.render(80).join("\n");
		assert.match(stripAnsi(rendered), /● Read\(src\/index\.ts\)/);
		assert.ok(rendered.includes("\x1b]8;;file:///tmp/project/src/index.ts"));
		assert.doesNotMatch(stripAnsi(call.render(9).join("\n")), /src\/index/);

		const grep = registered[2]!.renderCall({ pattern: "needle", path: "src" }, theme, {
			executionStarted: true,
			isError: false,
			isPartial: false,
		});
		assert.ok(grep.render(80).join("\n").includes("\x1b]8;;file:///tmp/project/src"));
	});
});
