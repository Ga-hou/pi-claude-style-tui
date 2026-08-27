import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const MAX_SUMMARY_CHARS = 120;
const MAX_EXPANDED_LINES = 30;

type RenderContext = {
	executionStarted: boolean;
	isError: boolean;
	isPartial: boolean;
};

type TextResult = {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
};

function singleLine(text: string, maxLength = MAX_SUMMARY_CHARS): string {
	const compact = text.replace(/\s+/g, " ").trim();
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

function renderCall(label: string, detail: string, theme: Theme, context: RenderContext): Text {
	const dotColor = context.isError
		? "error"
		: context.executionStarted && !context.isPartial
			? "success"
			: "accent";
	const suffix = detail ? theme.fg("muted", `(${singleLine(detail)})`) : "";
	return new Text(`${theme.fg(dotColor, "●")} ${theme.fg("toolTitle", theme.bold(label))}${suffix}`, 1, 0);
}

function renderResult(
	result: TextResult,
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: RenderContext,
	summary: (output: string) => string,
): Text {
	const output = resultText(result);
	if (options.isPartial) {
		const progress = singleLine(output) || "Working…";
		return new Text(theme.fg("dim", `  └ ${progress}`), 1, 0);
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

/** Register compact render-only overrides for Pi-owned local built-in tools. */
export function registerClaudeToolRenderers(pi: ExtensionAPI, cwd: string): void {
	const piOwnedTools = new Set(
		pi.getAllTools()
			.filter((tool) => tool.sourceInfo.source === "builtin")
			.map((tool) => tool.name),
	);

	if (piOwnedTools.has("read")) {
		const tool = createReadToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Read", args.path, theme, context),
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
				return renderResult(result, options, theme, context, (output) => lineSummary("Returned", output));
			},
		});
	}

	if (piOwnedTools.has("edit")) {
		const tool = createEditToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Edit", args.path, theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, () => "Updated");
			},
		});
	}

	if (piOwnedTools.has("write")) {
		const tool = createWriteToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => renderCall("Write", args.path, theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, () => "Written");
			},
		});
	}

	if (piOwnedTools.has("grep")) {
		const tool = createGrepToolDefinition(cwd);
		pi.registerTool({
			...tool,
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const location = args.path ? ` in ${args.path}` : "";
				return renderCall("Grep", `${quote(args.pattern)}${location}`, theme, context);
			},
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
			renderCall: (args, theme, context) => {
				const location = args.path ? ` in ${args.path}` : "";
				return renderCall("Find", `${quote(args.pattern)}${location}`, theme, context);
			},
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
			renderCall: (args, theme, context) => renderCall("List", args.path ?? ".", theme, context),
			renderResult(result, options, theme, context) {
				if (options.expanded && tool.renderResult) return tool.renderResult(result, options, theme, context);
				return renderResult(result, options, theme, context, (output) => lineSummary("Listed", output));
			},
		});
	}
}
