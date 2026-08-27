import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const BRAND_RGB = "215;119;87";
export const CLAUDE_SUBTLE_RGB = "80;80;80";
export const CLAUDE_SUGGESTION_RGB = "177;185;249";
export const CLAUDE_WARNING_RGB = "255;193;7";
const foreground = (rgb: string, text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;
export const brand = (text: string) => foreground(BRAND_RGB, text);
export const claudeSubtle = (text: string) => foreground(CLAUDE_SUBTLE_RGB, text);
export const claudeSuggestion = (text: string) => foreground(CLAUDE_SUGGESTION_RGB, text);
export const claudeWarning = (text: string) => foreground(CLAUDE_WARNING_RGB, text);

/** Strip CSI SGR and APC sequences so border detection can inspect plain text. */
export function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_[^\x07]*\x07/g, "");
}

export function formatCwd(cwd: string, home = process.env.HOME): string {
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Prefer `provider/id` when available (matches other pi extension examples). */
export function formatModelLabel(model: { provider?: string; id?: string } | null | undefined): string {
	if (!model?.id) return "Default model";
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export function formatThinkingLabel(level: string): string {
	return level === "off" ? "off" : level;
}

export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
	return `${totalSeconds}s`;
}

export function formatTokenCount(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${Math.round(tokens / 1000)}k`;
}

export const SHOW_TURN_STATS_AFTER_MS = 30_000;

export function getStreamDeltaLength(event: { type: string; delta?: unknown }): number {
	if (
		(event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta")
		&& typeof event.delta === "string"
	) return event.delta.length;
	return 0;
}

export function formatWorkingMessage(
	verb: string,
	milliseconds: number,
	responseLength: number,
	verbose = false,
): string {
	if (!verbose && milliseconds <= SHOW_TURN_STATS_AFTER_MS) return `${verb}…`;

	const parts = [formatDuration(milliseconds)];
	const outputTokens = Math.round(responseLength / 4);
	if (outputTokens > 0) parts.push(`↓ ${formatTokenCount(outputTokens)} tokens`);
	return `${verb}… (${parts.join(" · ")})`;
}

export function formatRunSummary(milliseconds: number, verb = "Worked"): string {
	return `${verb} for ${formatDuration(milliseconds)}`;
}

export const TURN_COMPLETION_VERBS = [
	"Baked",
	"Brewed",
	"Churned",
	"Cogitated",
	"Cooked",
	"Crunched",
	"Sautéed",
	"Worked",
] as const;

export function pickCompletionVerb(random = Math.random): string {
	const value = Math.max(0, Math.min(0.999999999, random()));
	return TURN_COMPLETION_VERBS[Math.floor(value * TURN_COMPLETION_VERBS.length)]!;
}

export function addUserPromptMarker(markdown: string, marker = "❯"): string {
	return markdown.startsWith("❯ ") ? markdown : `${marker} ${markdown}`;
}

function rawIndexAtPlainOffset(raw: string, offset: number): number {
	let plainOffset = 0;
	for (let index = 0; index < raw.length;) {
		if (raw[index] === "\x1b" && raw[index + 1] === "[") {
			const end = raw.indexOf("m", index + 2);
			if (end !== -1) {
				index = end + 1;
				continue;
			}
		}
		if (raw[index] === "\x1b" && raw[index + 1] === "_") {
			const end = raw.indexOf("\x07", index + 2);
			if (end !== -1) {
				index = end + 1;
				continue;
			}
		}
		if (plainOffset === offset) return index;
		plainOffset++;
		index++;
	}
	return raw.length;
}

export function highlightSlashCommands(
	lines: string[],
	commandNames: ReadonlySet<string>,
	paint: (text: string) => string,
): string[] {
	const bottomBorder = findBottomBorderIndex(lines);
	return lines.map((line, lineIndex) => {
		if (lineIndex === 0 || lineIndex >= bottomBorder) return line;
		const plain = stripAnsi(line);
		const ranges: Array<{ start: number; end: number }> = [];
		for (const match of plain.matchAll(/(^|\s)\/([A-Za-z0-9_:-]+)/g)) {
			if (!commandNames.has(match[2]!)) continue;
			const start = match.index + match[1]!.length;
			ranges.push({ start, end: start + match[0].length - match[1]!.length });
		}
		return ranges.reverse().reduce((rendered, range) => {
			const start = rawIndexAtPlainOffset(rendered, range.start);
			const end = rawIndexAtPlainOffset(rendered, range.end);
			return rendered.slice(0, start) + paint(rendered.slice(start, end)) + rendered.slice(end);
		}, line);
	});
}

/** Claude-style gerunds used while Pi is generating a response. */
export const PI_WORKING_VERBS = [
	"Accomplishing",
	"Actioning",
	"Actualizing",
	"Architecting",
	"Baking",
	"Beaming",
	"Beboppin'",
	"Befuddling",
	"Billowing",
	"Blanching",
	"Bloviating",
	"Boogieing",
	"Boondoggling",
	"Booping",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Burrowing",
	"Calculating",
	"Canoodling",
	"Caramelizing",
	"Cascading",
	"Catapulting",
	"Cerebrating",
	"Channeling",
	"Channelling",
	"Choreographing",
	"Churning",
	"Clauding",
	"Coalescing",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Computing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Creating",
	"Crunching",
	"Crystallizing",
	"Cultivating",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Dilly-dallying",
	"Discombobulating",
	"Doing",
	"Doodling",
	"Drizzling",
	"Ebbing",
	"Effecting",
	"Elucidating",
	"Embellishing",
	"Enchanting",
	"Envisioning",
	"Evaporating",
	"Fermenting",
	"Fiddle-faddling",
	"Finagling",
	"Flambéing",
	"Flibbertigibbeting",
	"Flowing",
	"Flummoxing",
	"Fluttering",
	"Forging",
	"Forming",
	"Frolicking",
	"Frosting",
	"Gallivanting",
	"Galloping",
	"Garnishing",
	"Generating",
	"Gesticulating",
	"Germinating",
	"Gitifying",
	"Grooving",
	"Gusting",
	"Harmonizing",
	"Hashing",
	"Hatching",
	"Herding",
	"Honking",
	"Hullaballooing",
	"Hyperspacing",
	"Ideating",
	"Imagining",
	"Improvising",
	"Incubating",
	"Inferring",
	"Infusing",
	"Ionizing",
	"Jitterbugging",
	"Julienning",
	"Kneading",
	"Leavening",
	"Levitating",
	"Lollygagging",
	"Manifesting",
	"Marinating",
	"Meandering",
	"Metamorphosing",
	"Misting",
	"Moonwalking",
	"Moseying",
	"Mulling",
	"Mustering",
	"Musing",
	"Nebulizing",
	"Nesting",
	"Newspapering",
	"Noodling",
	"Nucleating",
	"Orbiting",
	"Orchestrating",
	"Osmosing",
	"Perambulating",
	"Percolating",
	"Perusing",
	"Philosophising",
	"Photosynthesizing",
	"Pollinating",
	"Pondering",
	"Pontificating",
	"Pouncing",
	"Precipitating",
	"Prestidigitating",
	"Processing",
	"Proofing",
	"Propagating",
	"Puttering",
	"Puzzling",
	"Quantumizing",
	"Razzle-dazzling",
	"Razzmatazzing",
	"Recombobulating",
	"Reticulating",
	"Roosting",
	"Ruminating",
	"Sautéing",
	"Scampering",
	"Schlepping",
	"Scurrying",
	"Seasoning",
	"Shenaniganing",
	"Shimmying",
	"Simmering",
	"Skedaddling",
	"Sketching",
	"Slithering",
	"Smooshing",
	"Sock-hopping",
	"Spelunking",
	"Spinning",
	"Sprouting",
	"Stewing",
	"Sublimating",
	"Swirling",
	"Swooping",
	"Symbioting",
	"Synthesizing",
	"Tempering",
	"Thinking",
	"Thundering",
	"Tinkering",
	"Tomfoolering",
	"Topsy-turvying",
	"Transfiguring",
	"Transmuting",
	"Twisting",
	"Undulating",
	"Unfurling",
	"Unravelling",
	"Vibing",
	"Waddling",
	"Wandering",
	"Warping",
	"Whatchamacalliting",
	"Whirlpooling",
	"Whirring",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zesting",
	"Zigzagging",
] as const;

/** Claude samples one verb when the spinner mounts; it does not rotate during a turn. */
export function pickWorkingVerb(random = Math.random): string {
	const value = Math.max(0, Math.min(0.999999999, random()));
	return PI_WORKING_VERBS[Math.floor(value * PI_WORKING_VERBS.length)]!;
}

export function center(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w >= width) return truncateToWidth(text, width, "…");
	return `${" ".repeat(Math.floor((width - w) / 2))}${text}`;
}

export function padRight(text: string, width: number, ellipsis = ""): string {
	const clipped = truncateToWidth(text, width, ellipsis);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * True for the editor's horizontal rule rows (plain ─ fill or scroll indicators).
 * Content and autocomplete rows start with padding spaces and do not match.
 */
export function isEditorBorderLine(line: string): boolean {
	const plain = stripAnsi(line);
	if (/^─+$/.test(plain)) return true;
	if (/^─*\s*[↑↓]\s+\d+\s+more\s*─*$/.test(plain)) return true;
	return false;
}

/** Index of the bottom border in Editor.render output (before autocomplete rows). */
export function findBottomBorderIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 1; i--) {
		if (isEditorBorderLine(lines[i]!)) return i;
	}
	return Math.max(0, lines.length - 1);
}

/** Replace the editor's two leading padding cells with Claude Code's prompt marker. */
export function addEditorPromptMarker(lines: string[], marker: string): string[] {
	if (lines.length < 3) return lines;
	const result = lines.slice();
	const bottomIdx = findBottomBorderIndex(result);
	for (let i = 1; i < bottomIdx; i++) {
		if (result[i]!.startsWith("  ")) {
			result[i] = `${marker} ${result[i]!.slice(2)}`;
			break;
		}
	}
	return result;
}

/** Replace editor borders with Claude Code-style straight separators. */
export function applyStraightEditorBorders(
	lines: string[],
	width: number,
	color: (text: string) => string = brand,
): string[] {
	if (lines.length === 0 || width < 2) return lines;

	const result = lines.slice();
	const bottomIdx = findBottomBorderIndex(result);
	result[0] = color("─".repeat(width));
	result[bottomIdx] = color("─".repeat(width));
	return result.map((line) => padRight(truncateToWidth(line, width, ""), width));
}
