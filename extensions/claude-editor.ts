import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { addEditorPromptMarker, applyStraightEditorBorders, highlightSlashCommands } from "./render-utils.ts";

const PI_BUILTIN_COMMAND_NAMES = [
	"settings",
	"model",
	"tree",
	"thinking",
	"scoped-models",
	"export",
	"import",
	"share",
	"copy",
	"name",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"trust",
	"login",
	"logout",
	"new",
	"compact",
	"resume",
	"reload",
	"quit",
	"statusline",
	"context",
	"reduced-motion",
] as const;

let activeEditor: ClaudeStyleEditor | undefined;
let editorLoading = false;

export function getClaudePromptStyle(
	text: string,
	loading: boolean,
): { marker: string; color: "text" | "dim" | "bashMode" } {
	if (text.trimStart().startsWith("!")) return { marker: "❯", color: "bashMode" };
	return { marker: "❯", color: loading ? "dim" : "text" };
}

export function setClaudeEditorLoading(loading: boolean): void {
	editorLoading = loading;
	activeEditor?.setLoading(loading);
}

export function disposeClaudeEditor(): void {
	activeEditor = undefined;
	editorLoading = false;
}

class ClaudeStyleEditor extends CustomEditor {
	private loading = editorLoading;
	private readonly tuiRef: TUI;
	private readonly paintMarker: (text: string, color: "text" | "dim" | "bashMode") => string;
	private readonly paintBorder: (text: string) => string;
	private readonly paintCommand: (text: string) => string;
	private readonly getCommandNames: () => ReadonlySet<string>;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		paintMarker: (text: string, color: "text" | "dim" | "bashMode") => string,
		paintBorder: (text: string) => string,
		paintCommand: (text: string) => string,
		getCommandNames: () => ReadonlySet<string>,
	) {
		super(tui, theme, keybindings, { paddingX: 2 });
		this.tuiRef = tui;
		this.paintMarker = paintMarker;
		this.paintBorder = paintBorder;
		this.paintCommand = paintCommand;
		this.getCommandNames = getCommandNames;
	}

	setLoading(loading: boolean): void {
		if (this.loading === loading) return;
		this.loading = loading;
		this.tuiRef.requestRender();
	}

	render(width: number): string[] {
		const highlighted = highlightSlashCommands(super.render(width), this.getCommandNames(), this.paintCommand);
		const prompt = getClaudePromptStyle(this.getText(), this.loading);
		const lines = addEditorPromptMarker(highlighted, this.paintMarker(prompt.marker, prompt.color));
		return applyStraightEditorBorders(lines, width, this.paintBorder);
	}
}

export function applyClaudeEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const paintSuggestion = (text: string) => ctx.ui.theme.fg("customMessageLabel", text);
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		activeEditor = new ClaudeStyleEditor(
			tui,
			{
				...theme,
				selectList: {
					...theme.selectList,
					selectedPrefix: paintSuggestion,
					selectedText: paintSuggestion,
				},
			},
			keybindings,
			(text, color) => ctx.ui.theme.fg(color, text),
			(text) => ctx.ui.theme.fg("borderMuted", text),
			paintSuggestion,
			() => new Set([...PI_BUILTIN_COMMAND_NAMES, ...pi.getCommands().map((command) => command.name)]),
		);
		return activeEditor;
	});
}
