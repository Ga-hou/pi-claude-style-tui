import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { addAssistantResponseMarker, registerClaudeToolRenderers } from "../extensions/claude-message-ui.ts";

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

describe("compact built-in tool renderers", () => {
	it("overrides only tools still owned by Pi", () => {
		const registered: Array<Record<string, any>> = [];
		const api = {
			getAllTools: () => [
				{ name: "read", sourceInfo: { source: "builtin" } },
				{ name: "bash", sourceInfo: { source: "builtin" } },
				{ name: "edit", sourceInfo: { source: "ssh-extension" } },
			],
			registerTool: (tool: Record<string, any>) => registered.push(tool),
		} as unknown as ExtensionAPI;

		registerClaudeToolRenderers(api, "/tmp/project");

		assert.deepEqual(
			registered.map((tool) => tool.name),
			["read", "bash"],
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
		assert.match(call.render(80).join("\n"), /● Read\(src\/index\.ts\)/);
	});
});
