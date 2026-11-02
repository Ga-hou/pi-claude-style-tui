import { randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ClaudeCodeTuiConfig = {
	statusLine?: unknown;
	reducedMotion?: unknown;
	theme?: unknown;
	footerRows?: unknown;
	github?: unknown;
};

export const CONFIG_PATH = join(getAgentDir(), "claude-code-tui.json");

export function validateClaudeCodeTuiConfig(value: unknown): ClaudeCodeTuiConfig {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Claude TUI config must be an object");
	const config = value as ClaudeCodeTuiConfig;
	if (
		config.statusLine !== undefined &&
		(!Array.isArray(config.statusLine) || config.statusLine.some((item) => typeof item !== "string"))
	) {
		throw new Error("statusLine must be an array of field names");
	}
	if (config.reducedMotion !== undefined && typeof config.reducedMotion !== "boolean")
		throw new Error("reducedMotion must be boolean");
	if (
		config.theme !== undefined &&
		config.theme !== false &&
		(typeof config.theme !== "string" || !config.theme.trim())
	)
		throw new Error("theme must be a theme name or false");
	if (config.footerRows !== undefined && config.footerRows !== 1 && config.footerRows !== 2)
		throw new Error("footerRows must be 1 or 2");
	if (config.github !== undefined && typeof config.github !== "boolean") throw new Error("github must be boolean");
	return config;
}

/** Poll the exact file so editor atomic renames and initially missing files work too. */
export function watchClaudeCodeTuiConfig(
	onChange: (config: ClaudeCodeTuiConfig) => void,
	onError: (error: Error) => void,
	path = CONFIG_PATH,
	interval = 1_000,
): () => void {
	let disposed = false;
	let revision = 0;
	const changed = async () => {
		const current = ++revision;
		try {
			const config = await loadClaudeCodeTuiConfig(path);
			if (!disposed && current === revision) onChange(config);
		} catch (error) {
			if (!disposed && current === revision) onError(error as Error);
		}
	};
	watchFile(path, { persistent: false, interval }, changed);
	return () => {
		disposed = true;
		revision++;
		unwatchFile(path, changed);
	};
}

export async function loadClaudeCodeTuiConfig(path = CONFIG_PATH): Promise<ClaudeCodeTuiConfig> {
	try {
		return validateClaudeCodeTuiConfig(JSON.parse(await readFile(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

export async function updateClaudeCodeTuiConfig(
	patch: Partial<ClaudeCodeTuiConfig>,
	path = CONFIG_PATH,
): Promise<void> {
	const config = await loadClaudeCodeTuiConfig(path);
	const next = validateClaudeCodeTuiConfig({ ...config, ...patch });
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function saveReducedMotion(reducedMotion: boolean): Promise<void> {
	await updateClaudeCodeTuiConfig({ reducedMotion });
}
