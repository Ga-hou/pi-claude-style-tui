import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	keyHint,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "./render-utils.ts";

const MAX_SUMMARY_CHARS = 120;
const MAX_EXPANDED_LINES = 30;

type RenderContext = {
	toolCallId?: string;
	executionStarted: boolean;
	isError: boolean;
	isPartial: boolean;
	args?: unknown;
};

type CallDetail = {
	plain: string;
	render: (maxWidth: number) => string;
};

const toolStartedAt = new Map<string, number>();

export function trackClaudeToolStart(toolCallId: string): void {
	toolStartedAt.set(toolCallId, Date.now());
}

export function trackClaudeToolEnd(toolCallId: string): void {
	toolStartedAt.delete(toolCallId);
}

type TextResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
};

function singleLine(text: string, maxLength = MAX_SUMMARY_CHARS): string {
	const sanitized = Array.from(text, (character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127 ? " " : character;
	}).join("");
	const compact = sanitized.replace(/\s+/g, " ").trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function quote(value: string): string {
	return value.includes(" ") ? JSON.stringify(value) : value;
}

function resultText(result: TextResult): string {
	return result.content
		.filter((item) => item.type === "text" && item.text)
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function nonEmptyLineCount(text: string): number {
	return text ? text.split("\n").filter((line) => line.trim()).length : 0;
}

function truncationSuffix(details: unknown): string {
	const value = details as { truncation?: { truncated?: boolean } } | undefined;
	return value?.truncation?.truncated ? " · truncated" : "";
}

export function addAssistantResponseMarker(markdown: string, marker = "●"): string {
	if (!markdown.trim() || markdown.startsWith(`${marker} `)) return markdown;

	// Claude renders its dot in a separate layout column. Pi only exposes a
	// Markdown transformer, so avoid prefixing block constructs whose parsing
	// would change when text is inserted before them.
	const firstLine = markdown.trimStart().split("\n", 1)[0]!;
	if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(firstLine)) return markdown;
	return `${marker} ${markdown}`;
}

export function formatToolPath(path: string, cwd: string): string {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	const fromCwd = relative(cwd, absolute);
	if (!fromCwd) return ".";
	if (fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`) && !isAbsolute(fromCwd)) return fromCwd;
	const fromHome = relative(homedir(), absolute);
	if (!fromHome) return "~";
	if (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome)) return `~/${fromHome}`;
	return absolute;
}

export function fileHyperlink(path: string, cwd: string, label: string): string {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	return `\x1b]8;;${pathToFileURL(absolute).href}\x07${singleLine(label, Number.MAX_SAFE_INTEGER)}\x1b]8;;\x07`;
}

function textDetail(detail: string, theme: Theme): CallDetail {
	const plain = singleLine(detail);
	return {
		plain,
		render: (maxWidth) => theme.fg("muted", truncateToWidth(plain, maxWidth, "…")),
	};
}

function pathDetail(path: string, cwd: string, theme: Theme): CallDetail {
	const plain = singleLine(formatToolPath(path, cwd));
	return {
		plain,
		render(maxWidth) {
			const display = truncateToWidth(plain, maxWidth, "…");
			return theme.fg("muted", fileHyperlink(path, cwd, display));
		},
	};
}

function searchDetail(pattern: string, path: string | undefined, cwd: string, theme: Theme): CallDetail {
	const query = singleLine(quote(pattern));
	if (!path) return textDetail(query, theme);
	const displayPath = singleLine(formatToolPath(path, cwd));
	const prefix = `${query} in `;
	const plain = `${prefix}${displayPath}`;
	return {
		plain,
		render(maxWidth) {
			const pathWidth = maxWidth - visibleWidth(prefix);
			if (pathWidth < 4) return theme.fg("muted", truncateToWidth(plain, maxWidth, "…"));
			const display = truncateToWidth(displayPath, pathWidth, "…");
			return `${theme.fg("muted", prefix)}${theme.fg("muted", fileHyperlink(path, cwd, display))}`;
		},
	};
}

class ResponsiveToolCall implements Component {
	private readonly label: string;
	private readonly detail: CallDetail | undefined;
	private readonly theme: Theme;
	private readonly context: RenderContext;

	constructor(label: string, detail: CallDetail | undefined, theme: Theme, context: RenderContext) {
		this.label = label;
		this.detail = detail;
		this.theme = theme;
		this.context = context;
	}

	render(width: number): string[] {
		const dotColor = this.context.isError
			? "error"
			: this.context.executionStarted && !this.context.isPartial
				? "success"
				: "accent";
		const prefix = `${this.theme.fg(dotColor, "●")} ${this.theme.fg("toolTitle", this.theme.bold(this.label))}`;
		const available = Math.max(0, width - visibleWidth(prefix) - 4);
		const suffix = this.detail && available >= 4 ? `(${this.detail.render(available - 2)})` : "";
		return new Text(`${prefix}${suffix}`, 1, 0).render(width);
	}

	invalidate(): void {}
}

function renderCall(label: string, detail: string | CallDetail, theme: Theme, context: RenderContext): Component {
	const normalized = typeof detail === "string" ? textDetail(detail, theme) : detail;
	return new ResponsiveToolCall(label, normalized.plain ? normalized : undefined, theme, context);
}

function renderResult(
	result: TextResult,
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: RenderContext,
	summary: (output: string) => string,
	partialSummary: (output: string) => string = (output) => singleLine(output) || "Working…",
): Text {
	const output = resultText(result);
	if (options.isPartial) {
		return new Text(theme.fg("dim", `  └ ${partialSummary(output)}`), 1, 0);
	}

	const isError = context.isError;
	const status = isError ? singleLine(output) || "Failed" : summary(output);
	const color = isError ? "error" : "dim";
	let text = theme.fg(color, `  └ ${status}${truncationSuffix(result.details)}`);

	if (output && !options.expanded) {
		text += theme.fg("dim", ` ${keyHint("app.tools.expand", "to expand")}`);
	} else if (output && options.expanded) {
		const lines = output.split("\n");
		for (const line of lines.slice(0, MAX_EXPANDED_LINES)) {
			text += `\n${theme.fg("toolOutput", `    ${line}`)}`;
		}
		if (lines.length > MAX_EXPANDED_LINES) {
			text += `\n${theme.fg("dim", `    … ${lines.length - MAX_EXPANDED_LINES} more lines`)}`;
		}
	}
	return new Text(text, 1, 0);
}

function lineSummary(noun: string, output: string): string {
	const count = nonEmptyLineCount(output);
	return count > 0 ? `${noun} ${count} ${count === 1 ? "line" : "lines"}` : "Done";
}

export function editSummary(details: unknown): string {
	const patch = (details as { patch?: unknown } | undefined)?.patch;
	if (typeof patch !== "string") return "Updated";
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	if (added === 0 && removed === 0) return "Updated";
	const parts = [
		...(added > 0 ? [`Added ${added} ${added === 1 ? "line" : "lines"}`] : []),
		...(removed > 0 ? [`removed ${removed} ${removed === 1 ? "line" : "lines"}`] : []),
	];
	return parts.join(", ");
}

export function writeSummary(content: unknown): string {
	if (typeof content !== "string") return "Written";
	const lines = content.split("\n");
	while (lines.at(-1) === "") lines.pop();
	return `Wrote ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
}

export function bashProgressSummary(output: string, elapsedMs: number): string {
	const lines = nonEmptyLineCount(output);
	if (elapsedMs < 2_000) {
		let latest = "";
		for (const line of output.split("\n")) {
			if (line.trim()) latest = line;
		}
		return singleLine(latest) || "Working…";
	}
	const parts = [formatDuration(elapsedMs), ...(lines > 0 ? [`${lines} ${lines === 1 ? "line" : "lines"}`] : [])];
	return `Running… (${parts.join(" · ")})`;
}

/** Register compact render-only overrides for Pi-owned local built-in tools. */
export function registerClaudeToolRenderers(pi: ExtensionAPI, cwd: string): void {
	const piOwnedTools = new Set(
		pi
			.getAllTools()
			.filter((tool) => tool.sourceInfo.source === "builtin")
			.map((tool) => tool.name),
	);

	if (piOwnedTools.has("read")) {
		const tool = createReadToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Read", pathDetail(args.path, cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if ((options.expanded || result.content[0]?.type === "image") && tool.renderResult) {
					return tool.renderResult(result, options, theme, context);
				}
				return renderResult(result, options, theme, context, (output) => lineSummary("Read", output));
			},
		});
	}

	if (piOwnedTools.has("bash")) {
		const tool = createBashToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Bash", args.command, theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				const startedAt = toolStartedAt.get(context.toolCallId);
				return renderResult(
					result,
					options,
					theme,
					context,
					(output) => lineSummary("Returned", output),
					(output) => bashProgressSummary(output, startedAt === undefined ? 0 : Date.now() - startedAt),
				);
			},
		});
	}

	if (piOwnedTools.has("edit")) {
		const tool = createEditToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Edit", pathDetail(args.path, cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, () => editSummary(result.details));
			},
		});
	}

	if (piOwnedTools.has("write")) {
		const tool = createWriteToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Write", pathDetail(args.path, cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, () =>
					writeSummary((context.args as { content?: unknown } | undefined)?.content),
				);
			},
		});
	}

	if (piOwnedTools.has("grep")) {
		const tool = createGrepToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) =>
				renderCall("Grep", searchDetail(args.pattern, args.path, cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, (output) => lineSummary("Found", output));
			},
		});
	}

	if (piOwnedTools.has("find")) {
		const tool = createFindToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) =>
				renderCall("Find", searchDetail(args.pattern, args.path, cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, (output) => lineSummary("Found", output));
			},
		});
	}

	if (piOwnedTools.has("ls")) {
		const tool = createLsToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) =>
				renderCall("List", pathDetail(args.path ?? ".", cwd, theme), theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, (output) => lineSummary("Listed", output));
			},
		});
	}
}
