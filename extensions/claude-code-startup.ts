import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	type ClaudeCodeTuiConfig,
	loadClaudeCodeTuiConfig,
	saveReducedMotion,
	watchClaudeCodeTuiConfig,
} from "./claude-config.ts";
import { showClaudeContext } from "./claude-context.ts";
import { applyClaudeEditor, disposeClaudeEditor, setClaudeEditorLoading } from "./claude-editor.ts";
import { applyClaudeFooter } from "./claude-footer.ts";
import { PiStartupHeader } from "./claude-header.ts";
import {
	addAssistantResponseMarker,
	registerClaudeToolRenderers,
	trackClaudeToolEnd,
	trackClaudeToolStart,
} from "./claude-message-ui.ts";
import { ClaudeRunTelemetry, type RunMetricsEntry } from "./claude-run-telemetry.ts";
import {
	DEFAULT_STATUS_LINE_ITEMS,
	normalizeStatusLineItems,
	type StatusLineItemId,
	saveStatusLineItems,
	showStatusLineSetup,
} from "./claude-status-line.ts";
import {
	addUserPromptMarker,
	formatClaudeTerminalTitle,
	formatRunSummary,
	getClaudeSpinnerFrames,
} from "./render-utils.ts";

let activeHeader: PiStartupHeader | undefined;
let disposeFooter: (() => void) | undefined;
let previousTheme: ExtensionContext["ui"]["theme"] | undefined;
let startupTimer: NodeJS.Timeout | undefined;
let sessionGeneration = 0;
let statusLineItems: StatusLineItemId[] = [...DEFAULT_STATUS_LINE_ITEMS];
let reducedMotion = false;
let themeName: string | false = "claude-code-dark";
let footerRows = 2;
let githubEnabled = false;
let paintUserPromptMarker = (text: string): string => text;

function disposeHeader(): void {
	activeHeader?.dispose();
	activeHeader = undefined;
}

function applyWorkingIndicator(ctx: ExtensionContext): void {
	ctx.ui.setWorkingIndicator(
		reducedMotion
			? { frames: [ctx.ui.theme.fg("accent", "●")] }
			: {
					frames: getClaudeSpinnerFrames().map((frame) => ctx.ui.theme.fg("accent", frame)),
					intervalMs: 120,
				},
	);
}

function applyClaudeLook(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	previousTheme ??= ctx.ui.theme;
	if (themeName !== false) {
		const result = ctx.ui.setTheme(themeName);
		if (!result.success) ctx.ui.notify(`Could not apply Claude TUI theme: ${result.error}`, "error");
	}
	paintUserPromptMarker = (text) => ctx.ui.theme.fg("dim", text);
	ctx.ui.setTitle(formatClaudeTerminalTitle(ctx.sessionManager.getSessionName() || basename(ctx.cwd) || "Pi", false));
	ctx.ui.setHeader((tui) => {
		disposeHeader();
		activeHeader = new PiStartupHeader(pi, ctx, tui, reducedMotion);
		return activeHeader;
	});
	refreshFooter(pi, ctx);
	applyWorkingIndicator(ctx);
	ctx.ui.setHiddenThinkingLabel("∴ Thinking…");
	applyClaudeEditor(pi, ctx);
}

function refreshFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	disposeFooter?.();
	disposeFooter = applyClaudeFooter(pi, ctx, statusLineItems, footerRows, githubEnabled);
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
	let stopConfigWatcher: (() => void) | undefined;

	function applyConfig(config: ClaudeCodeTuiConfig, ctx: ExtensionContext, live: boolean): void {
		const nextTheme = config.theme === false ? false : ((config.theme as string | undefined) ?? "claude-code-dark");
		const themeChanged = nextTheme !== themeName;
		themeName = nextTheme;
		statusLineItems = normalizeStatusLineItems(config.statusLine);
		footerRows = (config.footerRows as number | undefined) ?? 2;
		githubEnabled = (config.github as boolean | undefined) ?? false;
		reducedMotion = (config.reducedMotion as boolean | undefined) ?? false;
		telemetry.setReducedMotion(reducedMotion);
		if (!live || ctx.mode !== "tui") return;
		if (themeChanged && themeName !== false) {
			const result = ctx.ui.setTheme(themeName);
			if (!result.success) ctx.ui.notify(`Could not apply Claude TUI theme: ${result.error}`, "error");
		}
		activeHeader?.setReducedMotion(reducedMotion);
		applyWorkingIndicator(ctx);
		refreshFooter(pi, ctx);
	}

	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
		if (messageType === "user") return addUserPromptMarker(markdown, paintUserPromptMarker("❯"));
		if (messageType === "assistant" && !isStreaming) return addAssistantResponseMarker(markdown);
		return markdown;
	});

	pi.registerEntryRenderer("claude-interrupted", (_entry, _options, theme) => {
		return new Text(theme.fg("dim", "Interrupted · What should Pi do instead?"), 1, 0);
	});

	pi.registerEntryRenderer("claude-run-metrics", (entry, _options, theme) => {
		const metrics = entry.data as RunMetricsEntry;
		const summary = formatRunSummary(metrics.durationMs, metrics.completionVerb);
		return new Text(theme.fg("dim", `✻ ${summary}`), 1, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		const generation = ++sessionGeneration;
		if (ctx.mode === "tui") registerClaudeToolRenderers(pi, ctx.cwd);
		stopConfigWatcher?.();
		try {
			const config = await loadClaudeCodeTuiConfig();
			if (generation !== sessionGeneration) return;
			applyConfig(config, ctx, false);
		} catch (error) {
			if (generation !== sessionGeneration) return;
			applyConfig({}, ctx, false);
			ctx.ui.notify(`Could not load Claude TUI config: ${(error as Error).message}`, "warning");
		}
		if (ctx.mode === "tui") {
			stopConfigWatcher = watchClaudeCodeTuiConfig(
				(config) => applyConfig(config, ctx, true),
				(error) => ctx.ui.notify(`Claude TUI config unchanged: ${error.message}`, "error"),
			);
		}
		scheduleClaudeLook(pi, ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		setClaudeEditorLoading(true);
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
		telemetry.showWorking(ctx, "up");
	});

	pi.on("tool_execution_start", (event, ctx) => {
		trackClaudeToolStart(event.toolCallId);
		telemetry.onToolStart(event.toolCallId, ctx);
	});

	pi.on("tool_execution_end", (event) => {
		trackClaudeToolEnd(event.toolCallId);
		telemetry.onToolEnd(event.toolCallId);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		telemetry.onMessageEnd(event.message);
	});

	pi.on("turn_end", (event, ctx) => {
		const message = event.message as { role?: string; stopReason?: string };
		if (ctx.mode === "tui" && message.role === "assistant" && message.stopReason === "aborted") {
			pi.appendEntry("claude-interrupted", {});
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle()) return;
		setClaudeEditorLoading(false);
		const metrics = telemetry.stop(ctx);
		if (metrics && ctx.mode === "tui") pi.appendEntry("claude-run-metrics", metrics);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionGeneration++;
		stopConfigWatcher?.();
		stopConfigWatcher = undefined;
		cancelStartupTimer();
		telemetry.stop(ctx);
		disposeClaudeEditor();
		disposeFooter?.();
		disposeFooter = undefined;
		disposeHeader();
		restorePreviousTheme(ctx);
	});

	pi.registerCommand("exit", {
		description: "Exit Pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	pi.registerCommand("reduced-motion", {
		description: "Toggle reduced motion for Claude-style working animations",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				ctx.ui.notify(`Reduced motion is ${reducedMotion ? "on" : "off"}`, "info");
				return;
			}
			if (value !== "on" && value !== "off") {
				ctx.ui.notify("Usage: /reduced-motion [on|off]", "error");
				return;
			}
			const next = value === "on";
			try {
				await saveReducedMotion(next);
			} catch (error) {
				ctx.ui.notify(`Could not save motion config: ${(error as Error).message}`, "error");
				return;
			}
			reducedMotion = next;
			telemetry.setReducedMotion(reducedMotion);
			activeHeader?.setReducedMotion(reducedMotion);
			if (ctx.mode === "tui") applyWorkingIndicator(ctx);
			ctx.ui.notify(`Reduced motion ${reducedMotion ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.registerCommand("context", {
		description: "Show Claude-style context usage",
		handler: async (_args, ctx) => {
			await showClaudeContext(ctx);
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
			refreshFooter(pi, ctx);
			ctx.ui.notify(selected.length > 0 ? "Status line updated" : "Status line hidden", "info");
		},
	});
}
