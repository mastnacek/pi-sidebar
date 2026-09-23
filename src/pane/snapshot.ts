import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ClickRequest, parseClickRequest } from "./click.js";

/** Bumped whenever {@link PaneSnapshot} changes shape. */
export const PANE_SNAPSHOT_VERSION = 1;

/**
 * Directory holding pane snapshots plus the renderer's pid lock.
 *
 * Deliberately outside the repo: it is per-machine runtime state, and every
 * session/pane pair owns its own file, so parallel pi instances never collide.
 */
export const PANE_STATE_DIR = join(homedir(), ".pi", "agent", "pi-sidebar");

/**
 * Transport between the extension (producer) and the standalone pane renderer
 * (consumer). The renderer is a plain ESM script with no imports, so the format
 * must stay JSON-only and the lines pre-styled/pre-padded by the extension.
 */
export interface PaneSnapshot {
	version: number;
	/** `false` once the owning session ended — the renderer then stops repainting. */
	live: boolean;
	/** Identity of the pane/session that produced this snapshot (diagnostics). */
	key: string;
	revision: number;
	width: number;
	generatedAt: string;
	/** Fully styled, width-padded terminal lines, border prefix included. */
	lines: string[];
	/**
	 * Clickable tab ranges (columns, measured on the padded line). Shipped with the
	 * frame so an interactive renderer never has to re-derive layout, and so it can
	 * report a click without knowing how tabs are laid out.
	 */
	tabHits?: Array<{ id: string; start: number; end: number }>;
}

/**
 * Snapshot file for one herdr pane. Keyed by pane id (`w1M:p1` → `w1M_p1.json`)
 * because a pane hosts exactly one pi session at a time and the pane id is the
 * only identifier both the extension and a fresh renderer process can agree on.
 */
export function resolveSnapshotPath(key: string | null | undefined): string {
	const safe = (key ?? "unbound").replace(/[^A-Za-z0-9._-]/g, "_");
	return join(PANE_STATE_DIR, `${safe}.json`);
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export function writePaneSnapshot(path: string, snapshot: PaneSnapshot): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
		renameSync(tmp, path);
		return true;
	} catch {
		return false;
	}
}

/** Never throws; a missing/corrupt snapshot is reported as `null`. */
export function readPaneSnapshot(path: string): PaneSnapshot | null {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PaneSnapshot>;
		if (!parsed || !Array.isArray(parsed.lines)) return null;
		return {
			version: Number(parsed.version ?? PANE_SNAPSHOT_VERSION),
			live: parsed.live !== false,
			key: String(parsed.key ?? ""),
			revision: Number(parsed.revision ?? 0),
			width: Number(parsed.width ?? 0),
			generatedAt: String(parsed.generatedAt ?? ""),
			lines: parsed.lines.map((line) => String(line)),
			tabHits: Array.isArray(parsed.tabHits)
				? parsed.tabHits.map((hit) => ({
						id: String(hit?.id ?? ""),
						start: Number(hit?.start ?? 0),
						end: Number(hit?.end ?? 0),
					}))
				: undefined,
		};
	} catch {
		return null;
	}
}

/**
 * Where a click lands for the extension to collect. A sidecar file (rather than
 * a pipe) keeps the renderer dependency-free and survives a herdr restart.
 */
export function resolveRequestPath(snapshotPath: string): string {
	return `${snapshotPath}.request.json`;
}

/**
 * Read and remove the pending click, if any. Consuming (unlinking) is what makes
 * repeated polling idempotent: one click is handled exactly once, and a stale
 * file from a previous session is rejected by its timestamp.
 */
export function consumeClickRequest(
	path: string,
	now: number = Date.now(),
): ClickRequest | null {
	if (!existsSync(path)) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Partially written file: leave it for the next poll.
		return null;
	}
	try {
		unlinkSync(path);
	} catch {
		// Non-fatal: the request file is best-effort.
	}
	return parseClickRequest(parsed, now);
}
