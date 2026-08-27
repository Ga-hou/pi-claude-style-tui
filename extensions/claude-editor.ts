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
] as const;

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

export function applyClaudeEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const paintSuggestion = (text: string) => ctx.ui.theme.fg("customMessageLabel", text);
	ctx.ui.setEditorComponent(
		(tui, theme, keybindings) =>
			new ClaudeStyleEditor(
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
				(text) => ctx.ui.theme.fg("text", text),
				(text) => ctx.ui.theme.fg("borderMuted", text),
				paintSuggestion,
				() => new Set([...PI_BUILTIN_COMMAND_NAMES, ...pi.getCommands().map((command) => command.name)]),
			),
	);
}
