import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import claudeCodeTui from "../extensions/claude-code-startup.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Command = { handler: (args: string, ctx: ExtensionContext) => unknown | Promise<unknown> };

function createHarness() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const workingMessages: Array<string | undefined> = [];
	let idle = true;

	const ui = {
		theme: {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		},
		setTheme() {
			return { success: true };
		},
		setTitle() {},
		setHeader() {},
		setFooter() {},
		setWorkingIndicator() {},
		setEditorComponent() {},
		setWorkingMessage(message?: string) {
			workingMessages.push(message);
		},
		notify() {},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp/project",
		model: { id: "test-model", contextWindow: 100_000 },
		ui,
		getContextUsage: () => undefined,
		isIdle: () => idle,
	} as unknown as ExtensionContext;
	const api = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerMarkdownTransformer() {},
		registerEntryRenderer() {},
		registerCommand(name: string, command: Command) {
			commands.set(name, command);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI;

	claudeCodeTui(api);

	return {
		commands,
		ctx,
		entries,
		workingMessages,
		setIdle(value: boolean) {
			idle = value;
		},
		async emit(name: string, event: unknown = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

describe("TUI lifecycle", () => {
	it("keeps custom run telemetry disabled after switching to the default TUI", async () => {
		const harness = createHarness();
		await harness.commands.get("use-default-tui")!.handler("", harness.ctx);
		harness.workingMessages.length = 0;

		await harness.emit("before_agent_start");
		await harness.emit("agent_start");
		await harness.emit("agent_settled");

		assert.deepEqual(harness.workingMessages, []);
		assert.deepEqual(harness.entries, []);
	});

	it("does not settle a newer run started by another extension", async () => {
		const harness = createHarness();
		await harness.commands.get("use-claude-style-tui")!.handler("", harness.ctx);
		await harness.emit("before_agent_start");
		assert.ok(harness.workingMessages.some((message) => message?.endsWith("…")));
		assert.ok(harness.workingMessages.every((message) => !message?.includes("↑") && !message?.includes("↓")));

		harness.setIdle(false);
		await harness.emit("agent_settled");
		assert.equal(harness.entries.length, 0);

		harness.setIdle(true);
		await harness.emit("agent_settled");
		assert.equal(harness.entries.length, 1);
		assert.equal(harness.entries[0]!.type, "claude-run-metrics");
		await harness.emit("session_shutdown");
	});
});
