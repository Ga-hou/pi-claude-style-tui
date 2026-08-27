import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { renderStatusLine, type StatusLineItemId } from "./claude-status-line.ts";

export function applyClaudeFooter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	items: readonly StatusLineItemId[],
): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const statusLine = renderStatusLine(
					items,
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
