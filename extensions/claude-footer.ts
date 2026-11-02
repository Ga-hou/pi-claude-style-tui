import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { RepositoryStatus } from "./claude-repository-status.ts";
import {
	layoutStatusLine,
	renderStatusLineSegments,
	type StatusLineItemId,
	StatusLineUsageCache,
} from "./claude-status-line.ts";

export function githubStatusFields(
	repository: RepositoryStatus | undefined,
	enabled: boolean,
): { pr: string; ci: string } {
	if (!enabled) return { pr: "PR disabled", ci: "CI disabled" };
	if (repository?.githubPending) return { pr: "PR loading…", ci: "CI loading…" };
	if (!repository?.git?.branch || repository.error || repository.githubError)
		return { pr: "PR unavailable", ci: "CI unavailable" };
	const github = repository.github;
	if (!github) return { pr: "PR none", ci: "CI none" };
	return {
		pr: `PR #${github.number} ${github.draft ? "draft" : github.review.toLowerCase().replaceAll("_", " ")}`,
		ci: `CI ${github.ci}`,
	};
}

export function applyClaudeFooter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	items: readonly StatusLineItemId[],
	maxRows = 2,
	githubEnabled = false,
): () => void {
	let dispose = () => {};
	ctx.ui.setFooter((tui, theme, footerData) => {
		const usageCache = new StatusLineUsageCache();
		const needsGitHub = githubEnabled && (items.includes("pr") || items.includes("ci"));
		const repository =
			items.includes("git") || needsGitHub
				? new RepositoryStatus(pi, ctx.cwd, () => tui.requestRender(), needsGitHub)
				: undefined;
		repository?.start();
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		// Keep model/effort and externally supplied statuses fresh even while idle.
		const timer = setInterval(() => tui.requestRender(), 1_000);
		timer.unref?.();
		let disposed = false;
		dispose = () => {
			if (disposed) return;
			disposed = true;
			clearInterval(timer);
			unsubscribe();
			repository?.dispose();
		};
		return {
			dispose,
			invalidate() {},
			render(width: number): string[] {
				const git = repository?.git;
				const statuses = footerData.getExtensionStatuses();
				const segments = renderStatusLineSegments(
					items,
					ctx,
					theme,
					git ? git.branch : footerData.getGitBranch(),
					pi.getThinkingLevel(),
					usageCache.get(ctx.sessionManager),
					{
						git: repository?.error
							? "git unavailable"
							: git
								? `git ${git.changedFiles ? `${git.changedFiles} files` : "clean"} +${git.added}/-${git.removed}`
								: undefined,
						...githubStatusFields(repository, needsGitHub),
						quota: statuses.get("usage"),
					},
				);
				const extensionStatus = [...statuses.entries()]
					.filter(([key, value]) => value && !(key === "usage" && items.includes("quota")))
					.map(([, value]) => value)
					.join(" · ");
				return [
					...layoutStatusLine(segments, width, theme, maxRows),
					...(extensionStatus ? [truncateToWidth(theme.fg("dim", extensionStatus), width, "…")] : []),
				];
			},
		};
	});
	return () => dispose();
}
