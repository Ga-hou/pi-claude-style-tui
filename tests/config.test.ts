import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
	loadClaudeCodeTuiConfig,
	updateClaudeCodeTuiConfig,
	validateClaudeCodeTuiConfig,
	watchClaudeCodeTuiConfig,
} from "../extensions/claude-config.ts";

it("rejects malformed configuration instead of silently applying defaults", () => {
	for (const config of [
		null,
		[],
		{ statusLine: 1 },
		{ statusLine: [1] },
		{ reducedMotion: "yes" },
		{ footerRows: 3 },
		{ theme: "" },
		{ github: "yes" },
	]) {
		assert.throws(() => validateClaudeCodeTuiConfig(config));
	}
	assert.deepEqual(validateClaudeCodeTuiConfig({ theme: false, reducedMotion: true, footerRows: 1 }), {
		theme: false,
		reducedMotion: true,
		footerRows: 1,
	});
});

it("saves atomically, preserves unrelated fields and does not overwrite invalid files", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "claude-tui-save-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "config.json");
	await writeFile(path, '{"custom":"preserved","footerRows":1}');
	await updateClaudeCodeTuiConfig({ reducedMotion: true }, path);
	assert.deepEqual(await loadClaudeCodeTuiConfig(path), { custom: "preserved", footerRows: 1, reducedMotion: true });
	await writeFile(path, "bad json");
	await assert.rejects(updateClaudeCodeTuiConfig({ reducedMotion: false }, path));
});

it("hot-loads atomic replacements, reports invalid JSON, recovers and stops on disposal", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "claude-tui-config-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "config.json");
	await writeFile(path, "{}");
	const values: unknown[] = [];
	const errors: Error[] = [];
	const stop = watchClaudeCodeTuiConfig(
		(value) => values.push(value),
		(error) => errors.push(error),
		path,
		20,
	);
	t.after(stop);
	const waitFor = async (predicate: () => boolean) => {
		const deadline = Date.now() + 3_000;
		while (!predicate() && Date.now() < deadline) await delay(20);
		assert.ok(predicate(), "config watcher did not deliver an update");
	};
	await delay(50);
	await writeFile(join(dir, "new.json"), '{"reducedMotion":true}');
	await rename(join(dir, "new.json"), path);
	await waitFor(() => values.some((value) => (value as any).reducedMotion === true));
	const lastGood = values.length;
	await writeFile(path, "{bad json");
	await waitFor(() => errors.length > 0);
	assert.equal(values.length, lastGood);
	await writeFile(path, '{"footerRows":1}');
	await waitFor(() => values.some((value) => (value as any).footerRows === 1));
	stop();
	const stopped = values.length;
	await writeFile(path, '{"reducedMotion":false}');
	await delay(80);
	assert.equal(values.length, stopped);
});
