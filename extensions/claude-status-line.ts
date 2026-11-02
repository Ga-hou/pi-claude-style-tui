import { type ExtensionCommandContext, type ExtensionContext, VERSION } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { updateClaudeCodeTuiConfig } from "./claude-config.ts";
import { formatCwd, formatDuration } from "./render-utils.ts";

export const STATUS_LINE_ITEM_IDS = [
	"model",
	"context",
	"directory",
	"git",
	"pr",
	"ci",
	"quota",
	"cache-expiry",
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
export const DEFAULT_STATUS_LINE_ITEMS: StatusLineItemId[] = ["model", "context", "directory", "git", "cache", "cost"];

const ITEM_DESCRIPTIONS: Record<StatusLineItemId, string> = {
	model: "Current model name and thinking level",
	context: "Used context and context-window size",
	directory: "Current directory and Git branch",
	git: "Live changed-file count and staged + unstaged added/removed lines",
	pr: "Open GitHub PR and review state (requires github: true and gh login)",
	ci: "Checks for the open GitHub PR (requires github: true)",
	quota: "Provider allowance from pi-usage; unavailable without that source",
	"cache-expiry": "Cache expiry availability; Pi does not expose a reliable TTL",
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

export async function saveStatusLineItems(items: readonly StatusLineItemId[]): Promise<void> {
	await updateClaudeCodeTuiConfig({ statusLine: items });
}

function usageFromEntry(entry: unknown): {
	usage?: Usage;
	assistant?: boolean;
} {
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

export function collectStatusLineUsage(entries: readonly unknown[], previous?: StatusLineUsage): StatusLineUsage {
	const totals: StatusLineUsage = previous
		? { ...previous }
		: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, durationMs: 0 };
	for (const entry of entries) {
		if (entry && typeof entry === "object") {
			const custom = entry as {
				type?: string;
				customType?: string;
				data?: { durationMs?: unknown };
			};
			if (
				custom.type === "custom" &&
				custom.customType === "claude-run-metrics" &&
				typeof custom.data?.durationMs === "number"
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

/** Session-wide accounting stays cumulative across tree navigation, like Pi's session cost. */
export class StatusLineUsageCache {
	private sessionId: string | undefined;
	private leafId: string | null | undefined;
	private readonly seen = new Set<string>();
	private totals = collectStatusLineUsage([]);

	get(manager: FooterSource["sessionManager"]): StatusLineUsage {
		const sessionId = manager.getSessionId();
		const leafId = manager.getLeafId();
		if (this.sessionId !== sessionId) {
			const entries = manager.getEntries();
			this.seen.clear();
			for (const entry of entries) this.seen.add(entry.id);
			this.totals = collectStatusLineUsage(entries);
			this.sessionId = sessionId;
		} else if (leafId !== this.leafId) {
			const added = [];
			let cursor = leafId;
			while (cursor && !this.seen.has(cursor)) {
				const entry = manager.getEntry(cursor);
				if (!entry) throw new Error(`Missing session entry: ${cursor}`);
				this.seen.add(cursor);
				added.push(entry);
				cursor = entry.parentId;
			}
			this.totals = collectStatusLineUsage(added.reverse(), this.totals);
		}
		this.leafId = leafId;
		return this.totals;
	}
}

function renderContext(source: FooterSource, theme: FooterTheme): string {
	const usage = source.getContextUsage();
	const contextWindow = usage?.contextWindow ?? source.model?.contextWindow ?? 0;
	const value = usage?.percent;
	const display =
		value === null || value === undefined
			? `ctx ?/${formatPiTokens(contextWindow)}`
			: `ctx ${Math.round(value)}%/${formatPiTokens(contextWindow)}`;
	if (value === null || value === undefined) return theme.fg("dim", display);
	if (value > 90) return theme.fg("error", display);
	if (value > 70) return theme.fg("warning", display);
	return theme.fg("dim", display);
}

export function renderStatusLineSegments(
	items: readonly StatusLineItemId[],
	source: FooterSource,
	theme: FooterTheme,
	branch: string | null = null,
	thinkingLevel = source.thinkingLevel,
	totals = collectStatusLineUsage(source.sessionManager.getEntries()),
	live: Partial<Record<StatusLineItemId, string>> = {},
): StatusLineSegment[] {
	const contextUsage = source.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? source.model?.contextWindow ?? 0;
	const usingSubscription = Boolean(
		source.model &&
			source.modelRegistry.isUsingOAuth(source.model) &&
			source.modelRegistry.getProvider(source.model.provider)?.auth.oauth?.isSubscription,
	);
	const modelName = source.model?.id ?? "no model";
	const modelDisplay = source.model?.reasoning
		? thinkingLevel === "off"
			? `${modelName} • thinking off`
			: `${modelName} • ${thinkingLevel}`
		: modelName;
	const values: Record<StatusLineItemId, string | undefined> = {
		model: theme.fg("customMessageLabel", modelDisplay),
		context: renderContext(source, theme),
		directory: theme.fg("success", `${formatCwd(source.cwd)}${branch ? ` (${branch})` : ""}`),
		git: live.git ? theme.fg("dim", live.git) : undefined,
		pr: theme.fg("dim", live.pr ?? "PR unavailable"),
		ci: theme.fg(
			live.ci === "CI fail" ? "error" : live.ci === "CI pass" ? "success" : "dim",
			live.ci ?? "CI unavailable",
		),
		quota: theme.fg("dim", live.quota ?? "quota unavailable"),
		"cache-expiry": theme.fg("dim", "cache expiry unavailable"),
		cache:
			totals.cacheRead > 0 || totals.cacheWrite > 0
				? theme.fg(
						"dim",
						[
							...(totals.cacheRead > 0 ? [`R${formatPiTokens(totals.cacheRead)}`] : []),
							...(totals.cacheWrite > 0 ? [`W${formatPiTokens(totals.cacheWrite)}`] : []),
							...(totals.latestCacheHitRate !== undefined ? [`CH${totals.latestCacheHitRate.toFixed(1)}%`] : []),
						].join(" "),
					)
				: undefined,
		cost:
			totals.cost > 0 || usingSubscription
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
		"context-remaining":
			contextUsage && contextUsage.percent !== null
				? theme.fg("dim", `ctx ${Math.max(0, Math.round(100 - contextUsage.percent))}% left`)
				: undefined,
		"context-window": contextWindow > 0 ? theme.fg("dim", `${formatPiTokens(contextWindow)} window`) : undefined,
		"input-tokens": totals.input > 0 ? theme.fg("dim", `↑${formatPiTokens(totals.input)}`) : undefined,
		"output-tokens": totals.output > 0 ? theme.fg("dim", `↓${formatPiTokens(totals.output)}`) : undefined,
		duration: totals.durationMs > 0 ? theme.fg("dim", formatDuration(totals.durationMs)) : undefined,
		"exceeds-200k":
			contextUsage && contextUsage.tokens !== null && contextUsage.tokens > 200_000
				? theme.fg("warning", ">200k")
				: undefined,
	};
	return items.flatMap((id) => (values[id] ? [{ id, text: values[id]! }] : []));
}

export type StatusLineSegment = { id: StatusLineItemId; text: string };

export function renderStatusLine(...args: Parameters<typeof renderStatusLineSegments>): string {
	return renderStatusLineSegments(...args)
		.map(({ text }) => text)
		.join(` ${args[2].fg("dim", "|")} `);
}

/** Preserve configured order; drop low-priority fields before clipping essential metrics. */
export function layoutStatusLine(
	segments: readonly StatusLineSegment[],
	width: number,
	theme: FooterTheme,
	maxRows = 2,
): string[] {
	if (width <= 0 || maxRows <= 0) return [];
	const separator = ` ${theme.fg("dim", "|")} `;
	const priority = (id: StatusLineItemId) =>
		id === "context" ? 0 : id === "model" ? 1 : id === "cost" ? 2 : id === "directory" ? 3 : 4;
	const kept = [...segments];
	while (kept.length) {
		const lines: string[] = [];
		for (const { text } of kept) {
			const field = truncateToWidth(text, width, "…");
			const last = lines.at(-1);
			if (last !== undefined && visibleWidth(last) + 3 + visibleWidth(field) <= width) {
				lines[lines.length - 1] = `${last}${separator}${field}`;
			} else lines.push(field);
		}
		if (lines.length <= maxRows) return lines;
		let remove = kept.length - 1;
		for (let i = kept.length - 2; i >= 0; i--) {
			if (priority(kept[i]!.id) > priority(kept[remove]!.id)) remove = i;
		}
		kept.splice(remove, 1);
	}
	return [];
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
			...STATUS_LINE_ITEM_IDS.filter((id) => !enabled.has(id)).map((id) => ({
				id,
				enabled: false,
			})),
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
		const component = new StatusLineSetup(configured, theme, (items) => renderStatusLine(items, ctx, theme), done);
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
