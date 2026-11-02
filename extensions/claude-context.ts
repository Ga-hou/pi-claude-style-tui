import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const PARTIAL_BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;

export function formatContextTokens(tokens: number): string {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return `${Math.round(tokens / 1_000)}k`;
}

export function buildContextBar(ratio: number, width: number): { used: string; free: string } {
	const clamped = Math.min(1, Math.max(0, ratio));
	const safeWidth = Math.max(0, Math.floor(width));
	const cells = clamped * safeWidth;
	const whole = Math.floor(cells);
	const partial = PARTIAL_BLOCKS[Math.floor((cells - whole) * PARTIAL_BLOCKS.length)] ?? "";
	const used = `${"█".repeat(whole)}${partial}`;
	return { used, free: "░".repeat(Math.max(0, safeWidth - whole - (partial ? 1 : 0))) };
}

function paintContextBar(ratio: number, width: number, theme: Theme): string {
	const bar = buildContextBar(ratio, width);
	return `${theme.fg("accent", bar.used)}${theme.fg("dim", bar.free)}`;
}

export async function showClaudeContext(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/context requires TUI mode", "error");
		return;
	}
	let timer: NodeJS.Timeout | undefined;
	try {
		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			timer = setInterval(() => tui.requestRender(), 1_000);
			timer.unref?.();
			return {
				render(width: number): string[] {
					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const tokens = usage?.tokens;
					const measuredRatio =
						tokens !== null && tokens !== undefined && contextWindow > 0 ? tokens / contextWindow : 0;
					const ratio = usage?.percent === null || usage?.percent === undefined ? measuredRatio : usage.percent / 100;
					const percent =
						usage?.percent === null || usage?.percent === undefined
							? tokens !== null && tokens !== undefined && contextWindow > 0
								? `${Math.round(measuredRatio * 100)}%`
								: "unknown"
							: `${Math.round(usage.percent)}%`;
					const free = tokens !== null && tokens !== undefined ? Math.max(0, contextWindow - tokens) : undefined;
					const barWidth = Math.max(1, Math.min(40, width - 4));
					const lines = [
						theme.fg("accent", theme.bold("Context Usage")),
						"",
						`  ${paintContextBar(ratio, barWidth, theme)}`,
						`  ${theme.fg("text", `${percent} used`)}${
							contextWindow > 0
								? theme.fg(
										"dim",
										` · ${tokens === null || tokens === undefined ? "?" : formatContextTokens(tokens)} / ${formatContextTokens(contextWindow)} tokens`,
									)
								: ""
						}`,
						...(contextWindow > 0 && free !== undefined
							? [`  ${theme.fg("dim", `${formatContextTokens(free)} tokens free`)}`]
							: []),
						"",
						theme.fg("dim", "Esc or Enter to close"),
					];
					return lines.map((line) => truncateToWidth(line, Math.max(0, width), "…"));
				},
				invalidate() {},
				handleInput(data: string) {
					if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) done();
				},
			};
		});
	} finally {
		clearInterval(timer);
	}
}
