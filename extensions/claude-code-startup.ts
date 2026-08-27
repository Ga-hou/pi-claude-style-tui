import {
	CustomEditor,
	VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	addEditorPromptMarker,
	addUserPromptMarker,
	applyStraightEditorBorders,
	brand,
	center,
	claudeSubtle,
	claudeSuggestion,
	formatCwd,
	formatAnimatedWorkingMessage,
	formatDuration,
	formatModelLabel,
	formatRunSummary,
	formatThinkingLabel,
	getClaudeSpinnerFrames,
	formatTokenCount,
	formatWorkingMessage,
	getStreamDeltaLength,
	highlightSlashCommands,
	pickCompletionVerb,
	pickWorkingVerb,
	padRight,
} from "./render-utils.ts";
import { addAssistantResponseMarker, registerClaudeToolRenderers } from "./claude-message-ui.ts";
import {
	DEFAULT_STATUS_LINE_ITEMS,
	loadStatusLineItems,
	renderStatusLine,
	saveStatusLineItems,
	showStatusLineSetup,
	type StatusLineItemId,
} from "./claude-status-line.ts";

const LOGO_CELL = "███";
const LOGO_ANIMATION_INTERVAL_MS = 120;
const PI_BUILTIN_COMMAND_NAMES = [
	"settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "copy",
	"name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new",
	"compact", "resume", "reload", "quit", "statusline",
] as const;

type LogoColor = "panel" | "cyan" | "red" | "green" | "orange" | "white" | "flash" | "brand";
type LogoFrame = {
	phase: number;
	active: "left" | "top" | "right" | "none";
	ax: number;
	ay: number;
	flash: boolean;
	white: boolean;
};

const LOGO_FRAMES: LogoFrame[] = [
	...Array.from({ length: 4 }, (_, ay) => ({ phase: 0, active: "left" as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 3 }, (_, ay) => ({ phase: 1, active: "top" as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 5 }, (_, ay) => ({ phase: 2, active: "right" as const, ax: 5, ay, flash: false, white: false })),
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: true, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: true, white: false },
	{ phase: 4, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: true },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: true },
	{ phase: 6, active: "none", ax: 0, ay: 0, flash: false, white: false },
];

const colorCell = (color: LogoColor, paintBrand: (text: string) => string): string => {
	switch (color) {
		case "cyan":
			return `\x1b[36m${LOGO_CELL}\x1b[39m`;
		case "red":
			return `\x1b[31m${LOGO_CELL}\x1b[39m`;
		case "green":
			return `\x1b[32m${LOGO_CELL}\x1b[39m`;
		case "orange":
		case "flash":
			return `\x1b[33m${LOGO_CELL}\x1b[39m`;
		case "white":
			return `\x1b[39m${LOGO_CELL}`;
		case "brand":
			return paintBrand(LOGO_CELL);
		default:
			return " ".repeat(LOGO_CELL.length);
	}
};

function hasCell(y: number, x: number, cells: string): boolean {
	return cells.split(" ").includes(`${y},${x}`);
}

function hasPiece(y: number, x: number, py: number, px: number, cells: string): boolean {
	return cells.split(" ").some((item) => {
		const [dy, dx] = item.split(",").map(Number);
		return y === py + dy && x === px + dx;
	});
}

function logoCellColor(frame: LogoFrame, y: number, x: number): LogoColor {
	if (frame.white) {
		return hasCell(y, x, "3,2 3,3 3,4 4,2 4,4 5,2 5,3 5,5 6,2 6,5") ? "white" : "panel";
	}
	if (frame.flash && y === 6 && x >= 1 && x <= 6) return "flash";

	switch (frame.active) {
		case "left":
			if (hasPiece(y, x, frame.ay, frame.ax, "0,0 1,0 1,1 2,0")) return "red";
			break;
		case "top":
			if (hasPiece(y, x, frame.ay, frame.ax, "0,0 0,1 0,2 1,2")) return "cyan";
			break;
		case "right":
			if (hasPiece(y, x, frame.ay, frame.ax, "0,0 1,0 2,0 2,1")) return "green";
			break;
	}

	if (frame.phase === 6) {
		return hasCell(y, x, "3,2 3,3 3,4 4,4 4,2 5,2 5,3 5,5 6,2 6,5") ? "brand" : "panel";
	}

	if (frame.phase === 4) {
		if (hasCell(y, x, "2,2 2,3 2,4 3,4")) return "cyan";
		if (hasCell(y, x, "3,2 4,2 4,3 5,2")) return "red";
		if (hasCell(y, x, "4,5 5,5")) return "green";
		return "panel";
	}

	if (frame.phase >= 5) {
		if (hasCell(y, x, "3,2 3,3 3,4 4,4")) return "cyan";
		if (hasCell(y, x, "4,2 5,2 5,3 6,2")) return "red";
		if (hasCell(y, x, "5,5 6,5")) return "green";
		return "panel";
	}

	if (frame.phase <= 3 && hasCell(y, x, "6,1 6,2 6,3 6,4")) return "orange";
	if (frame.phase >= 2 && hasCell(y, x, "2,2 2,3 2,4 3,4")) return "cyan";
	if (frame.phase >= 1 && hasCell(y, x, "3,2 4,2 4,3 5,2")) return "red";
	if (frame.phase >= 3 && hasCell(y, x, "4,5 5,5 6,5 6,6")) return "green";
	return "panel";
}

function piLogoFrame(frameIndex: number, paintBrand: (text: string) => string): string[] {
	const frame = LOGO_FRAMES[frameIndex % LOGO_FRAMES.length]!;
	// Crop the installer's 9-row canvas vertically for a compact header, then
	// tight-crop empty columns so the mark centers cleanly in the logo half
	// (same idea as Claude Code's centered mascot).
	const grid: LogoColor[][] = [];
	for (let y = 1; y <= 7; y++) {
		const row: LogoColor[] = [];
		for (let x = 1; x <= 8; x++) row.push(logoCellColor(frame, y, x));
		grid.push(row);
	}

	let minX = 7;
	let maxX = 0;
	for (const row of grid) {
		row.forEach((cell, x) => {
			if (cell !== "panel") {
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
			}
		});
	}
	if (maxX < minX) {
		minX = 0;
		maxX = 7;
	}

	return grid.map((row) => {
		let line = "";
		for (let x = minX; x <= maxX; x++) line += colorCell(row[x]!, paintBrand);
		return line;
	});
}

function borderLine(
	left: string,
	label: string,
	right: string,
	width: number,
	paint: (text: string) => string,
): string {
	if (width <= 1) return "";
	if (width < 8 || label.length === 0) {
		return paint(truncateToWidth(left + "─".repeat(Math.max(0, width - 2)) + right, width, ""));
	}

	const before = "─── ";
	const after = " ─────";
	const fixedWidth = visibleWidth(before) + visibleWidth(label) + visibleWidth(after);
	const fill = Math.max(0, width - 2 - fixedWidth);
	return `${paint(left)}${paint(before)}${label}${paint(after)}${paint("─".repeat(fill))}${paint(right)}`;
}

function boxedLine(content: string, width: number, paint: (text: string) => string): string {
	if (width <= 2) return truncateToWidth(content, width, "");
	return `${paint("│")}${padRight(content, width - 2)}${paint("│")}`;
}

class PiStartupHeader implements Component {
	private frame = 0;
	private readonly timer: NodeJS.Timeout;
	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;

	constructor(pi: ExtensionAPI, ctx: ExtensionContext, tui: TUI) {
		this.pi = pi;
		this.ctx = ctx;
		this.tui = tui;
		this.timer = setInterval(() => {
			if (this.frame < LOGO_FRAMES.length - 1) {
				this.frame++;
				this.tui.requestRender();
			} else {
				clearInterval(this.timer);
			}
		}, LOGO_ANIMATION_INTERVAL_MS);
		this.timer.unref?.();
	}

	render(width: number): string[] {
		const theme = this.ctx.ui.theme;
		const paint = brand;
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const bold = (s: string) => theme.bold(s);

		if (width < 24) return [truncateToWidth(paint(`Pi Code v${VERSION}`), Math.max(0, width), "")];

		const innerWidth = width - 2;
		const model = formatModelLabel(this.ctx.model);
		const effort = formatThinkingLabel(this.pi.getThinkingLevel());
		const cwd = formatCwd(this.ctx.cwd);
		const content = [
			"",
			center(bold("Welcome back!"), innerWidth),
			"",
			...piLogoFrame(this.frame, paint).map((line) => center(line, innerWidth)),
			"",
			center(muted(model), innerWidth),
			center(muted(`${effort} thinking`), innerWidth),
			center(dim(cwd), innerWidth),
			"",
		];

		const lines = [borderLine("╭", paint("Pi Code"), "╮", width, paint)];
		for (const line of content) lines.push(boxedLine(padRight(line, innerWidth), width, paint));
		lines.push(borderLine("╰", "", "╯", width, paint));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}
}

class ClaudeStyleEditor extends CustomEditor {
	private readonly paintMarker: (text: string) => string;
	private readonly paintBorder: (text: string) => string;
	private readonly paintCommand: (text: string) => string;
	private readonly getCommandNames: () => ReadonlySet<string>;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		paintMarker: (text: string) => string,
		paintBorder: (text: string) => string,
		paintCommand: (text: string) => string,
		getCommandNames: () => ReadonlySet<string>,
	) {
		super(tui, theme, keybindings, { paddingX: 2 });
		this.paintMarker = paintMarker;
		this.paintBorder = paintBorder;
		this.paintCommand = paintCommand;
		this.getCommandNames = getCommandNames;
	}

	render(width: number): string[] {
		const highlighted = highlightSlashCommands(super.render(width), this.getCommandNames(), this.paintCommand);
		const lines = addEditorPromptMarker(highlighted, this.paintMarker("❯"));
		return applyStraightEditorBorders(lines, width, this.paintBorder);
	}
}

type RunMetricsEntry = {
	durationMs: number;
	completionVerb?: string;
};

let activePiStartupHeader: PiStartupHeader | undefined;
let previousTheme: ExtensionContext["ui"]["theme"] | undefined;
let startupTimer: NodeJS.Timeout | undefined;
let sessionGeneration = 0;
let claudeLookEnabled = true;
let runRefreshTimer: NodeJS.Timeout | undefined;
let runContext: ExtensionContext | undefined;
let runStartedAt: number | undefined;
let completedResponseLength = 0;
let streamingResponseLength = 0;
let thinkingActive = false;
let workingVerb = "Thinking";
let statusLineItems: StatusLineItemId[] = [...DEFAULT_STATUS_LINE_ITEMS];

function getResponseLength(message: { content: unknown }): number {
	if (!Array.isArray(message.content)) return 0;
	return message.content.reduce((total, block) => {
		if (!block || typeof block !== "object") return total;
		if ("text" in block && typeof block.text === "string") return total + block.text.length;
		if ("thinking" in block && typeof block.thinking === "string") return total + block.thinking.length;
		if ("type" in block && block.type === "toolCall" && "arguments" in block) {
			return total + (JSON.stringify(block.arguments)?.length ?? 0);
		}
		return total;
	}, 0);
}

function clearRunTimers(): void {
	if (runRefreshTimer) clearInterval(runRefreshTimer);
	runRefreshTimer = undefined;
}

function updateWorkingMessage(): void {
	if (runContext?.mode !== "tui" || runStartedAt === undefined) return;
	const elapsedMs = Date.now() - runStartedAt;
	const message = formatWorkingMessage(
		workingVerb,
		elapsedMs,
		completedResponseLength + streamingResponseLength,
		false,
		thinkingActive ? runContext.thinkingLevel : undefined,
	);
	runContext.ui.setWorkingMessage(formatAnimatedWorkingMessage(message, elapsedMs));
}

function startRun(ctx: ExtensionContext, reset: boolean): void {
	if (!reset && runStartedAt !== undefined) {
		runContext = ctx;
		return;
	}

	clearRunTimers();
	runContext?.ui.setWorkingMessage(undefined);
	runContext = ctx;
	if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
	runStartedAt = Date.now();
	completedResponseLength = 0;
	streamingResponseLength = 0;
	thinkingActive = false;
	workingVerb = pickWorkingVerb();
	updateWorkingMessage();

	runRefreshTimer = setInterval(updateWorkingMessage, 200);
	runRefreshTimer.unref?.();
}

function stopRun(ctx?: ExtensionContext): RunMetricsEntry | undefined {
	clearRunTimers();
	const activeContext = runContext ?? ctx;
	if (activeContext?.mode === "tui") {
		activeContext.ui.setWorkingMessage(undefined);
		activeContext.ui.setWorkingVisible(true);
	}
	if (runStartedAt === undefined) {
		runContext = undefined;
		return undefined;
	}

	const metrics = {
		durationMs: Date.now() - runStartedAt,
		completionVerb: pickCompletionVerb(),
	};
	runContext = undefined;
	runStartedAt = undefined;
	completedResponseLength = 0;
	streamingResponseLength = 0;
	thinkingActive = false;
	return metrics;
}

function disposeActiveHeader(): void {
	activePiStartupHeader?.dispose();
	activePiStartupHeader = undefined;
}

function applyClaudeFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const statusLine = renderStatusLine(
					statusLineItems,
					ctx,
					theme,
					footerData.getGitBranch(),
					pi.getThinkingLevel(),
				);
				const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean).join(" · ");
				return [
					...(statusLine ? [truncateToWidth(statusLine, width, "…")] : []),
					...(statuses ? [truncateToWidth(theme.fg("dim", statuses), width, "…")] : []),
				];
			},
		};
	});
}

function applyPiLook(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	previousTheme ??= ctx.ui.theme;
	ctx.ui.setTheme("claude-code-dark");
	ctx.ui.setTitle("Pi");
	ctx.ui.setHeader((tui) => {
		disposeActiveHeader();
		activePiStartupHeader = new PiStartupHeader(pi, ctx, tui);
		return activePiStartupHeader;
	});
	applyClaudeFooter(pi, ctx);
	ctx.ui.setWorkingIndicator({
		frames: getClaudeSpinnerFrames().map(brand),
		intervalMs: 120,
	});
	ctx.ui.setHiddenThinkingLabel("∴ Thinking…");
	ctx.ui.setEditorComponent((tui, theme, keybindings) =>
		new ClaudeStyleEditor(
			tui,
			{
				...theme,
				selectList: {
					...theme.selectList,
					selectedPrefix: claudeSuggestion,
					selectedText: claudeSuggestion,
				},
			},
			keybindings,
			(text) => ctx.ui.theme.fg("text", text),
			(text) => ctx.ui.theme.fg("borderMuted", text),
			claudeSuggestion,
			() => new Set([...PI_BUILTIN_COMMAND_NAMES, ...pi.getCommands().map((command) => command.name)]),
		)
	);
}

function cancelStartupTimer(): void {
	if (startupTimer) clearTimeout(startupTimer);
	startupTimer = undefined;
}

function schedulePiLook(pi: ExtensionAPI, ctx: ExtensionContext): void {
	cancelStartupTimer();
	const generation = ++sessionGeneration;
	startupTimer = setTimeout(() => {
		startupTimer = undefined;
		if (claudeLookEnabled && generation === sessionGeneration) applyPiLook(pi, ctx);
	}, 0);
	startupTimer.unref?.();
}

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
		if (!claudeLookEnabled) return markdown;
		if (messageType === "user") return addUserPromptMarker(markdown, claudeSubtle("❯"));
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
		schedulePiLook(pi, ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (claudeLookEnabled) startRun(ctx, true);
	});

	pi.on("agent_start", (_event, ctx) => {
		if (claudeLookEnabled) startRun(ctx, false);
	});

	pi.on("message_update", (event, ctx) => {
		if (!claudeLookEnabled || event.message.role !== "assistant") return;
		streamingResponseLength += getStreamDeltaLength(event.assistantMessageEvent);
		const streamEvent = event.assistantMessageEvent;
		const delta = (
			streamEvent.type === "thinking_delta"
			|| streamEvent.type === "text_delta"
			|| streamEvent.type === "toolcall_delta"
		) && typeof streamEvent.delta === "string"
			? streamEvent.delta
			: "";
		if (streamEvent.type === "thinking_delta" && delta.trim().length > 0) {
			thinkingActive = true;
			if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
		} else if (streamEvent.type === "text_delta" && delta.trim().length > 0) {
			thinkingActive = false;
			if (ctx.mode === "tui") ctx.ui.setWorkingVisible(false);
		} else if (streamEvent.type === "toolcall_delta") {
			thinkingActive = false;
		}
		updateWorkingMessage();
	});

	pi.on("turn_start", (_event, ctx) => {
		if (!claudeLookEnabled) return;
		thinkingActive = false;
		if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
	});

	pi.on("tool_execution_start", (_event, ctx) => {
		if (!claudeLookEnabled) return;
		thinkingActive = false;
		if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
	});

	pi.on("message_end", (event) => {
		if (!claudeLookEnabled || event.message.role !== "assistant") return;
		completedResponseLength += Math.max(streamingResponseLength, getResponseLength(event.message));
		streamingResponseLength = 0;
		updateWorkingMessage();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!claudeLookEnabled || !ctx.isIdle()) return;
		const metrics = stopRun(ctx);
		if (metrics && ctx.mode === "tui") pi.appendEntry("claude-run-metrics", metrics);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionGeneration++;
		cancelStartupTimer();
		stopRun(ctx);
		disposeActiveHeader();
		if (previousTheme && ctx.mode === "tui") ctx.ui.setTheme(previousTheme);
		previousTheme = undefined;
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
			if (claudeLookEnabled) applyClaudeFooter(pi, ctx);
			ctx.ui.notify(selected.length > 0 ? "Status line updated" : "Status line hidden", "info");
		},
	});

	pi.registerCommand("use-claude-style-tui", {
		description: "Switch to the Claude-style header, editor, footer, and theme",
		handler: async (_args, ctx) => {
			claudeLookEnabled = true;
			applyPiLook(pi, ctx);
			ctx.ui.notify("Using pi-claude-style-tui", "info");
		},
	});

	pi.registerCommand("use-default-tui", {
		description: "Switch back to pi's built-in header, footer, editor, and spinner",
		handler: async (_args, ctx) => {
			claudeLookEnabled = false;
			cancelStartupTimer();
			stopRun(ctx);
			disposeActiveHeader();
			if (previousTheme) ctx.ui.setTheme(previousTheme);
			previousTheme = undefined;
			ctx.ui.setTitle("pi");
			ctx.ui.setHeader(undefined);
			ctx.ui.setFooter(undefined);
			ctx.ui.setWorkingIndicator(undefined);
			ctx.ui.setWorkingVisible(true);
			ctx.ui.setHiddenThinkingLabel(undefined);
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.notify("Using default pi TUI", "info");
		},
	});
}
