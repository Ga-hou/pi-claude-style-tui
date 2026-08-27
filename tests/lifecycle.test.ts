import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import claudeCodeTui from "../extensions/claude-code-startup.ts";
import { stripAnsi } from "../extensions/render-utils.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Command = { handler: (args: string, ctx: ExtensionContext) => unknown | Promise<unknown> };

function createHarness() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const workingMessages: Array<string | undefined> = [];
	const workingVisibility: boolean[] = [];
	let markdownTransformer: ((markdown: string, context: any) => string) | undefined;
	let footerFactory: ((tui: any, theme: any, footerData: any) => { render(width: number): string[] }) | undefined;
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
		setFooter(factory?: typeof footerFactory) {
			footerFactory = factory;
		},
		setWorkingIndicator() {},
		setWorkingVisible(visible: boolean) {
			workingVisibility.push(visible);
		},
		setHiddenThinkingLabel() {},
		setEditorComponent() {},
		setWorkingMessage(message?: string) {
			workingMessages.push(message);
		},
		notify() {},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp/project",
		model: { id: "test-model", provider: "test", contextWindow: 100_000, reasoning: true },
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
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI;

	claudeCodeTui(api);

	return {
		commands,
		ctx,
		entries,
		workingMessages,
		workingVisibility,
		renderFooter(width = 120) {
			if (!footerFactory) return [];
			return footerFactory(
				{ requestRender() {} },
				ui.theme,
				{
					onBranchChange: () => () => {},
					getGitBranch: () => "main",
					getExtensionStatuses: () => new Map(),
				},
			).render(width);
		},
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

	it("shows thinking with the model and omits the hotkeys footer hint", async () => {
		const harness = createHarness();
		await harness.commands.get("use-claude-style-tui")!.handler("", harness.ctx);
		const footer = harness.renderFooter().join("\n");
		assert.match(footer, /test-model • medium/);
		assert.doesNotMatch(footer, /hotkeys|medium mode/);
	});

	it("shows the assistant dot only after streaming settles", async () => {
		const harness = createHarness();
		await harness.commands.get("use-claude-style-tui")!.handler("", harness.ctx);

		assert.equal(
			harness.transformMarkdown("hello", { messageType: "assistant", isStreaming: true }),
			"hello",
		);
		assert.equal(
			harness.transformMarkdown("hello", { messageType: "assistant", isStreaming: false }),
			"● hello",
		);
	});

	it("hides working on visible text and restores it for the next turn", async () => {
		const harness = createHarness();
		await harness.commands.get("use-claude-style-tui")!.handler("", harness.ctx);
		await harness.emit("before_agent_start");
		assert.equal(harness.workingVisibility.at(-1), true);
		assert.ok(harness.workingMessages.every((message) =>
			!message || !stripAnsi(message).includes("effort"),
		));

		await harness.emit("message_update", {
			message: { role: "assistant" },
			assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" },
		});
		assert.equal(harness.workingVisibility.at(-1), true);
		assert.ok(harness.workingMessages.some((message) =>
			message && stripAnsi(message).includes("(thinking with xhigh effort)"),
		));

		await harness.emit("message_update", {
			message: { role: "assistant" },
			assistantMessageEvent: { type: "text_delta", delta: "hello" },
		});
		assert.equal(harness.workingVisibility.at(-1), false);

		await harness.emit("turn_start");
		assert.equal(harness.workingVisibility.at(-1), true);
		await harness.emit("session_shutdown");
	});

	it("does not settle a newer run started by another extension", async () => {
		const harness = createHarness();
		await harness.commands.get("use-claude-style-tui")!.handler("", harness.ctx);
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
