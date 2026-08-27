import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { applyClaudeEditor } from "./claude-editor.ts";
import { applyClaudeFooter } from "./claude-footer.ts";
import { PiStartupHeader } from "./claude-header.ts";
import { addAssistantResponseMarker, registerClaudeToolRenderers } from "./claude-message-ui.ts";
import { ClaudeRunTelemetry, type RunMetricsEntry } from "./claude-run-telemetry.ts";
import {
	DEFAULT_STATUS_LINE_ITEMS,
	loadStatusLineItems,
	type StatusLineItemId,
	saveStatusLineItems,
	showStatusLineSetup,
} from "./claude-status-line.ts";
import { addUserPromptMarker, formatRunSummary, getClaudeSpinnerFrames } from "./render-utils.ts";

let activeHeader: PiStartupHeader | undefined;
let previousTheme: ExtensionContext["ui"]["theme"] | undefined;
let startupTimer: NodeJS.Timeout | undefined;
let sessionGeneration = 0;
let statusLineItems: StatusLineItemId[] = [...DEFAULT_STATUS_LINE_ITEMS];
let paintUserPromptMarker = (text: string): string => text;

function disposeHeader(): void {
	activeHeader?.dispose();
	activeHeader = undefined;
}

function applyClaudeLook(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	previousTheme ??= ctx.ui.theme;
	ctx.ui.setTheme("claude-code-dark");
	paintUserPromptMarker = (text) => ctx.ui.theme.fg("dim", text);
	ctx.ui.setTitle("Pi");
	ctx.ui.setHeader((tui) => {
		disposeHeader();
		activeHeader = new PiStartupHeader(pi, ctx, tui);
		return activeHeader;
	});
	applyClaudeFooter(pi, ctx, statusLineItems);
	ctx.ui.setWorkingIndicator({
		frames: getClaudeSpinnerFrames().map((frame) => ctx.ui.theme.fg("accent", frame)),
		intervalMs: 120,
	});
	ctx.ui.setHiddenThinkingLabel("∴ Thinking…");
	applyClaudeEditor(pi, ctx);
}

function cancelStartupTimer(): void {
	if (startupTimer) clearTimeout(startupTimer);
	startupTimer = undefined;
}

function scheduleClaudeLook(pi: ExtensionAPI, ctx: ExtensionContext): void {
	cancelStartupTimer();
	const generation = ++sessionGeneration;
	startupTimer = setTimeout(() => {
		startupTimer = undefined;
		if (generation === sessionGeneration) applyClaudeLook(pi, ctx);
	}, 0);
	startupTimer.unref?.();
}

function restorePreviousTheme(ctx: ExtensionContext): void {
	if (previousTheme && ctx.mode === "tui") ctx.ui.setTheme(previousTheme);
	previousTheme = undefined;
	paintUserPromptMarker = (text) => text;
}

export default function (pi: ExtensionAPI) {
	const telemetry = new ClaudeRunTelemetry();

	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
		if (messageType === "user") return addUserPromptMarker(markdown, paintUserPromptMarker("❯"));
		if (messageType === "assistant" && !isStreaming) return addAssistantResponseMarker(markdown);
		return markdown;
	});

	pi.registerEntryRenderer("claude-run-metrics", (entry, _options, theme) => {
		const metrics = entry.data as RunMetricsEntry;
		const summary = formatRunSummary(metrics.durationMs, metrics.completionVerb);
		return new Text(theme.fg("dim", `✻ ${summary}`), 1, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui") registerClaudeToolRenderers(pi, ctx.cwd);
		try {
			statusLineItems = await loadStatusLineItems();
		} catch (error) {
			statusLineItems = [...DEFAULT_STATUS_LINE_ITEMS];
			ctx.ui.notify(`Could not load status line config: ${(error as Error).message}`, "warning");
		}
		scheduleClaudeLook(pi, ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		telemetry.start(ctx, true);
	});

	pi.on("agent_start", (_event, ctx) => {
		telemetry.start(ctx, false);
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		telemetry.onStream(event.assistantMessageEvent, ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		telemetry.showWorking(ctx);
	});

	pi.on("tool_execution_start", (_event, ctx) => {
		telemetry.showWorking(ctx);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		telemetry.onMessageEnd(event.message);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle()) return;
		const metrics = telemetry.stop(ctx);
		if (metrics && ctx.mode === "tui") pi.appendEntry("claude-run-metrics", metrics);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionGeneration++;
		cancelStartupTimer();
		telemetry.stop(ctx);
		disposeHeader();
		restorePreviousTheme(ctx);
	});

	pi.registerCommand("exit", {
		description: "Exit Pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	pi.registerCommand("statusline", {
		description: "Configure Claude-style footer items and order",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/statusline requires TUI mode", "error");
				return;
			}
			const selected = await showStatusLineSetup(ctx, statusLineItems);
			if (selected === null) return;
			try {
				await saveStatusLineItems(selected);
			} catch (error) {
				ctx.ui.notify(`Could not save status line config: ${(error as Error).message}`, "error");
				return;
			}
			statusLineItems = selected;
			applyClaudeFooter(pi, ctx, statusLineItems);
			ctx.ui.notify(selected.length > 0 ? "Status line updated" : "Status line hidden", "info");
		},
	});
}
