import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import claudeCodeTui from "../extensions/claude-code-startup.ts";
import { stripAnsi } from "../extensions/render-utils.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Command = {
	handler: (args: string, ctx: ExtensionContext) => unknown | Promise<unknown>;
};

function createHarness() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const workingMessages: Array<string | undefined> = [];
	const workingVisibility: boolean[] = [];
	let markdownTransformer: ((markdown: string, context: any) => string) | undefined;
	let selectedTheme: string | undefined;
	let headerConfigured = false;
	let footerConfigured = false;
	let editorConfigured = false;
	let workingIndicatorConfigured = false;
	let idle = true;
	let shutdownCalls = 0;

	const ui = {
		theme: {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		},
		setTheme(theme: string) {
			selectedTheme = theme;
			return { success: true };
		},
		setTitle() {},
		setHeader() {
			headerConfigured = true;
		},
		setFooter() {
			footerConfigured = true;
		},
		setWorkingIndicator() {
			workingIndicatorConfigured = true;
		},
		setWorkingVisible(visible: boolean) {
			workingVisibility.push(visible);
		},
		setHiddenThinkingLabel() {},
		setEditorComponent() {
			editorConfigured = true;
		},
		setWorkingMessage(message?: string) {
			workingMessages.push(message);
		},
		notify() {},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp/project",
		model: {
			id: "test-model",
			provider: "test",
			contextWindow: 100_000,
			reasoning: true,
		},
		modelRegistry: {
			isUsingOAuth: () => false,
			getProvider: () => undefined,
		},
		thinkingLevel: "xhigh",
		sessionManager: {
			getEntries: () => [],
			getSessionName: () => undefined,
			getSessionId: () => "session-123",
			getSessionFile: () => "/tmp/session.jsonl",
		},
		ui,
		getContextUsage: () => undefined,
		isIdle: () => idle,
		shutdown: () => {
			shutdownCalls++;
		},
	} as unknown as ExtensionContext;
	const api = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerMarkdownTransformer(transformer: (markdown: string, context: any) => string) {
			markdownTransformer = transformer;
		},
		registerEntryRenderer() {},
		registerCommand(name: string, command: Command) {
			commands.set(name, command);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		getAllTools: () => [],
		registerTool() {},
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI;

	claudeCodeTui(api);

	return {
		commands,
		ctx,
		entries,
		workingMessages,
		workingVisibility,
		getShutdownCalls: () => shutdownCalls,
		getUiState: () => ({
			selectedTheme,
			headerConfigured,
			footerConfigured,
			editorConfigured,
			workingIndicatorConfigured,
		}),
		transformMarkdown(markdown: string, context: any) {
			return markdownTransformer?.(markdown, context) ?? markdown;
		},
		setIdle(value: boolean) {
			idle = value;
		},
		async emit(name: string, event: unknown = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

describe("TUI lifecycle", () => {
	it("registers /exit as a /quit-equivalent shutdown command", async () => {
		const harness = createHarness();

		await harness.commands.get("exit")!.handler("", harness.ctx);

		assert.equal(harness.getShutdownCalls(), 1);
	});

	it("applies the custom TUI automatically on session start", async () => {
		const harness = createHarness();

		await harness.emit("session_start");
		await new Promise((resolve) => setTimeout(resolve, 1));

		assert.deepEqual(harness.getUiState(), {
			selectedTheme: "claude-code-dark",
			headerConfigured: true,
			footerConfigured: true,
			editorConfigured: true,
			workingIndicatorConfigured: true,
		});
		await harness.emit("session_shutdown");
	});

	it("shows the assistant dot only after streaming settles", () => {
		const harness = createHarness();

		assert.equal(
			harness.transformMarkdown("hello", {
				messageType: "assistant",
				isStreaming: true,
			}),
			"hello",
		);
		assert.equal(
			harness.transformMarkdown("hello", {
				messageType: "assistant",
				isStreaming: false,
			}),
			"● hello",
		);
	});

	it("hides working on visible text and restores it for the next turn", async () => {
		const harness = createHarness();
		await harness.emit("before_agent_start");
		assert.equal(harness.workingVisibility.at(-1), true);
		assert.ok(harness.workingMessages.every((message) => !message || !stripAnsi(message).includes("effort")));

		await harness.emit("message_update", {
			message: { role: "assistant" },
			assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" },
		});
		assert.equal(harness.workingVisibility.at(-1), true);
		assert.ok(
			harness.workingMessages.some((message) => message && stripAnsi(message).includes("(thinking with xhigh effort)")),
		);

		await harness.emit("message_update", {
			message: { role: "assistant" },
			assistantMessageEvent: { type: "text_delta", delta: "hello" },
		});
		assert.equal(harness.workingVisibility.at(-1), false);

		await harness.emit("turn_start");
		assert.equal(harness.workingVisibility.at(-1), true);
		await harness.emit("session_shutdown");
	});

	it("uses request direction and actual output usage for later turns", async () => {
		const harness = createHarness();
		const originalNow = Date.now;
		let now = 1_000;
		Date.now = () => now;
		try {
			await harness.emit("before_agent_start");
			await harness.emit("message_end", {
				message: {
					role: "assistant",
					content: [{ type: "text", text: "short" }],
					usage: { output: 1_250 },
				},
			});
			now += 30_001;

			await harness.emit("turn_start");
			assert.ok(stripAnsi(harness.workingMessages.at(-1)!).includes("↑ 1.3k tokens"));

			await harness.emit("message_update", {
				message: { role: "assistant" },
				assistantMessageEvent: { type: "text_delta", delta: "next" },
			});
			assert.ok(stripAnsi(harness.workingMessages.at(-1)!).includes("↓ 1.3k tokens"));
		} finally {
			Date.now = originalNow;
			await harness.emit("session_shutdown");
		}
	});

	it("does not settle a newer run started by another extension", async () => {
		const harness = createHarness();
		await harness.emit("before_agent_start");
		assert.ok(harness.workingMessages.length > 0);
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
