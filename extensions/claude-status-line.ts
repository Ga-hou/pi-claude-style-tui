import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	getAgentDir,
	VERSION,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { claudeSuggestion, formatCwd, formatDuration } from "./render-utils.ts";

export const STATUS_LINE_ITEM_IDS = [
	"model",
	"context",
	"directory",
	"cache",
	"cost",
	"session-name",
	"session-id",
	"transcript-path",
	"version",
	"context-remaining",
	"context-window",
	"input-tokens",
	"output-tokens",
	"duration",
	"exceeds-200k",
] as const;
export type StatusLineItemId = (typeof STATUS_LINE_ITEM_IDS)[number];
export const DEFAULT_STATUS_LINE_ITEMS: StatusLineItemId[] = [
	"model",
	"context",
	"directory",
	"cache",
	"cost",
];

const CONFIG_PATH = join(getAgentDir(), "claude-code-tui.json");
const ITEM_DESCRIPTIONS: Record<StatusLineItemId, string> = {
	model: "Current model name and thinking level",
	context: "Used context and context-window size",
	directory: "Current directory and Git branch",
	cache: "Pi cache reads, writes, and latest hit rate",
	cost: "Pi cumulative session cost",
	"session-name": "Human-readable Pi session name",
	"session-id": "Pi session identifier",
	"transcript-path": "Pi session transcript path",
	version: "Pi application version",
	"context-remaining": "Percentage of context remaining",
	"context-window": "Current model context-window size",
	"input-tokens": "Cumulative session input tokens",
	"output-tokens": "Cumulative session output tokens",
	duration: "Cumulative completed run duration",
	"exceeds-200k": "Shown after current context exceeds 200k tokens",
};

type Usage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
};

export type StatusLineUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	durationMs: number;
	latestCacheHitRate?: number;
};

type FooterTheme = Pick<ExtensionContext["ui"]["theme"], "fg" | "bold">;
type FooterSource = Pick<
	ExtensionContext,
	"cwd" | "model" | "modelRegistry" | "sessionManager" | "thinkingLevel" | "getContextUsage"
>;

function isStatusLineItemId(value: unknown): value is StatusLineItemId {
	return typeof value === "string" && STATUS_LINE_ITEM_IDS.includes(value as StatusLineItemId);
}

export function normalizeStatusLineItems(value: unknown): StatusLineItemId[] {
	if (!Array.isArray(value)) return [...DEFAULT_STATUS_LINE_ITEMS];
	return [...new Set(value.filter(isStatusLineItemId))];
}

export async function loadStatusLineItems(): Promise<StatusLineItemId[]> {
	try {
		const config = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as { statusLine?: unknown };
		if (!Array.isArray(config.statusLine)) {
			throw new Error(`Invalid statusLine in ${CONFIG_PATH}`);
		}
		return normalizeStatusLineItems(config.statusLine);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [...DEFAULT_STATUS_LINE_ITEMS];
		throw error;
	}
}

export async function saveStatusLineItems(items: readonly StatusLineItemId[]): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify({ statusLine: items }, null, 2)}\n`, "utf8");
}

function usageFromEntry(entry: unknown): { usage?: Usage; assistant?: boolean } {
	if (!entry || typeof entry !== "object") return {};
	const candidate = entry as {
		type?: string;
		message?: { role?: string; usage?: Usage };
		usage?: Usage;
	};
	if (candidate.type === "message" && candidate.message?.role === "assistant") {
		return { usage: candidate.message.usage, assistant: true };
	}
	if (candidate.type === "message" && candidate.message?.role === "toolResult") {
		return { usage: candidate.message.usage };
	}
	if (candidate.type === "branch_summary" || candidate.type === "compaction") {
		return { usage: candidate.usage };
	}
	return {};
}

function formatPiTokens(tokens: number): string {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
	if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
	if (tokens < 10_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${Math.round(tokens / 1_000_000)}M`;
}

export function collectStatusLineUsage(entries: readonly unknown[]): StatusLineUsage {
	const totals: StatusLineUsage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		durationMs: 0,
	};
	for (const entry of entries) {
		if (entry && typeof entry === "object") {
			const custom = entry as { type?: string; customType?: string; data?: { durationMs?: unknown } };
			if (
				custom.type === "custom"
				&& custom.customType === "claude-run-metrics"
				&& typeof custom.data?.durationMs === "number"
			) {
				totals.durationMs += custom.data.durationMs;
			}
		}
		const { usage, assistant } = usageFromEntry(entry);
		if (!usage) continue;
		totals.input += usage.input ?? 0;
		totals.output += usage.output ?? 0;
		totals.cacheRead += usage.cacheRead ?? 0;
		totals.cacheWrite += usage.cacheWrite ?? 0;
		totals.cost += usage.cost?.total ?? 0;
		if (assistant) {
			const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
			if (promptTokens > 0) totals.latestCacheHitRate = ((usage.cacheRead ?? 0) / promptTokens) * 100;
		}
	}
	return totals;
}

function renderContext(source: FooterSource, theme: FooterTheme): string {
	const usage = source.getContextUsage();
	const contextWindow = usage?.contextWindow ?? source.model?.contextWindow ?? 0;
	const value = usage?.percent;
	const display = value === null || value === undefined
		? `ctx ?/${formatPiTokens(contextWindow)}`
		: `ctx ${Math.round(value)}%/${formatPiTokens(contextWindow)}`;
	if (value === null || value === undefined) return theme.fg("dim", display);
	if (value < 90) return theme.fg("warning", display);
	return theme.fg("error", display);
}

export function renderStatusLine(
	items: readonly StatusLineItemId[],
	source: FooterSource,
	theme: FooterTheme,
	branch: string | null = null,
	thinkingLevel = source.thinkingLevel,
): string {
	const totals = collectStatusLineUsage(source.sessionManager.getEntries());
	const contextUsage = source.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? source.model?.contextWindow ?? 0;
	const usingSubscription = Boolean(
		source.model
		&& source.modelRegistry.isUsingOAuth(source.model)
		&& source.modelRegistry.getProvider(source.model.provider)?.auth.oauth?.isSubscription,
	);
	const modelName = source.model?.id ?? "no model";
	const modelDisplay = source.model?.reasoning
		? thinkingLevel === "off"
			? `${modelName} • thinking off`
			: `${modelName} • ${thinkingLevel}`
		: modelName;
	const values: Record<StatusLineItemId, string | undefined> = {
		model: claudeSuggestion(modelDisplay),
		context: renderContext(source, theme),
		directory: theme.fg("success", `${formatCwd(source.cwd)}${branch ? ` (${branch})` : ""}`),
		cache: totals.cacheRead > 0 || totals.cacheWrite > 0
			? theme.fg("dim", [
				...(totals.cacheRead > 0 ? [`R${formatPiTokens(totals.cacheRead)}`] : []),
				...(totals.cacheWrite > 0 ? [`W${formatPiTokens(totals.cacheWrite)}`] : []),
				...(totals.latestCacheHitRate !== undefined ? [`CH${totals.latestCacheHitRate.toFixed(1)}%`] : []),
			].join(" "))
			: undefined,
		cost: totals.cost > 0 || usingSubscription
			? theme.fg("dim", `$${totals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`)
			: undefined,
		"session-name": source.sessionManager.getSessionName()
			? theme.fg("dim", source.sessionManager.getSessionName()!)
			: undefined,
		"session-id": theme.fg("dim", source.sessionManager.getSessionId()),
		"transcript-path": source.sessionManager.getSessionFile()
			? theme.fg("dim", source.sessionManager.getSessionFile()!)
			: undefined,
		version: theme.fg("dim", `v${VERSION}`),
		"context-remaining": contextUsage && contextUsage.percent !== null
			? theme.fg("dim", `ctx ${Math.max(0, Math.round(100 - contextUsage.percent))}% left`)
			: undefined,
		"context-window": contextWindow > 0 ? theme.fg("dim", `${formatPiTokens(contextWindow)} window`) : undefined,
		"input-tokens": totals.input > 0 ? theme.fg("dim", `↑${formatPiTokens(totals.input)}`) : undefined,
		"output-tokens": totals.output > 0 ? theme.fg("dim", `↓${formatPiTokens(totals.output)}`) : undefined,
		duration: totals.durationMs > 0 ? theme.fg("dim", formatDuration(totals.durationMs)) : undefined,
		"exceeds-200k": contextUsage && contextUsage.tokens !== null && contextUsage.tokens > 200_000
			? theme.fg("warning", ">200k")
			: undefined,
	};
	const separator = ` ${theme.fg("dim", "|")} `;
	return items.map((item) => values[item]).filter((value): value is string => Boolean(value)).join(separator);
}

class StatusLineSetup implements Component {
	private selected = 0;
	private readonly items: Array<{ id: StatusLineItemId; enabled: boolean }>;
	private readonly theme: FooterTheme;
	private readonly preview: (items: readonly StatusLineItemId[]) => string;
	private readonly done: (items: StatusLineItemId[] | null) => void;

	constructor(
		configured: readonly StatusLineItemId[],
		theme: FooterTheme,
		preview: (items: readonly StatusLineItemId[]) => string,
		done: (items: StatusLineItemId[] | null) => void,
	) {
		this.theme = theme;
		this.preview = preview;
		this.done = done;
		const enabled = new Set(configured);
		this.items = [
			...configured.map((id) => ({ id, enabled: true })),
			...STATUS_LINE_ITEM_IDS.filter((id) => !enabled.has(id)).map((id) => ({ id, enabled: false })),
		];
	}

	private enabledItems(): StatusLineItemId[] {
		return this.items.filter((item) => item.enabled).map((item) => item.id);
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
		} else if (matchesKey(data, Key.down)) {
			this.selected = Math.min(this.items.length - 1, this.selected + 1);
		} else if (matchesKey(data, Key.left) && this.selected > 0) {
			[this.items[this.selected - 1], this.items[this.selected]] = [
				this.items[this.selected]!,
				this.items[this.selected - 1]!,
			];
			this.selected--;
		} else if (matchesKey(data, Key.right) && this.selected < this.items.length - 1) {
			[this.items[this.selected], this.items[this.selected + 1]] = [
				this.items[this.selected + 1]!,
				this.items[this.selected]!,
			];
			this.selected++;
		} else if (matchesKey(data, Key.space)) {
			this.items[this.selected]!.enabled = !this.items[this.selected]!.enabled;
		} else if (matchesKey(data, Key.enter)) {
			this.done(this.enabledItems());
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done(null);
		}
	}

	render(width: number): string[] {
		const preview = this.preview(this.enabledItems());
		const visibleCount = 8;
		const start = Math.max(0, Math.min(this.selected - Math.floor(visibleCount / 2), this.items.length - visibleCount));
		const end = Math.min(this.items.length, start + visibleCount);
		const itemLines = this.items.slice(start, end).map((item, offset) => {
			const index = start + offset;
			const cursor = index === this.selected ? this.theme.fg("accent", "❯") : " ";
			const checkbox = item.enabled ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
			const label = index === this.selected ? this.theme.fg("accent", item.id) : item.id;
			return `${cursor} ${checkbox} ${label} ${this.theme.fg("dim", `— ${ITEM_DESCRIPTIONS[item.id]}`)}`;
		});
		const lines = [
			this.theme.fg("accent", this.theme.bold("Configure Status Line")),
			this.theme.fg("dim", "Space toggle · ←/→ reorder · Enter save · Esc cancel"),
			"",
			`${this.theme.fg("dim", "Preview: ")}${preview || this.theme.fg("dim", "(hidden)")}`,
			"",
			...(start > 0 ? [this.theme.fg("dim", `  ↑ ${start} more`)] : []),
			...itemLines,
			...(end < this.items.length ? [this.theme.fg("dim", `  ↓ ${this.items.length - end} more`)] : []),
		];
		return lines.map((line) => truncateToWidth(line, Math.max(0, width), "…"));
	}

	invalidate(): void {}
}

export async function showStatusLineSetup(
	ctx: ExtensionCommandContext,
	configured: readonly StatusLineItemId[],
): Promise<StatusLineItemId[] | null> {
	if (ctx.mode !== "tui") return null;
	return ctx.ui.custom<StatusLineItemId[] | null>((tui, theme, _keybindings, done) => {
		const component = new StatusLineSetup(
			configured,
			theme,
			(items) => renderStatusLine(items, ctx, theme),
			done,
		);
		return {
			render: (width) => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: (data) => {
				component.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}
