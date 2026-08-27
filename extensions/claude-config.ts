import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ClaudeCodeTuiConfig = {
	statusLine?: unknown;
	reducedMotion?: unknown;
};

const CONFIG_PATH = join(getAgentDir(), "claude-code-tui.json");

export async function loadClaudeCodeTuiConfig(): Promise<ClaudeCodeTuiConfig> {
	try {
		return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ClaudeCodeTuiConfig;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

export async function updateClaudeCodeTuiConfig(patch: Partial<ClaudeCodeTuiConfig>): Promise<void> {
	const config = await loadClaudeCodeTuiConfig();
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify({ ...config, ...patch }, null, 2)}\n`, "utf8");
}

export async function loadReducedMotion(): Promise<boolean> {
	const { reducedMotion } = await loadClaudeCodeTuiConfig();
	if (reducedMotion === undefined) return false;
	if (typeof reducedMotion !== "boolean") throw new Error(`Invalid reducedMotion in ${CONFIG_PATH}`);
	return reducedMotion;
}

export async function saveReducedMotion(reducedMotion: boolean): Promise<void> {
	await updateClaudeCodeTuiConfig({ reducedMotion });
}
