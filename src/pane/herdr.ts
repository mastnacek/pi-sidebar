import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Thin, failure-tolerant wrapper around the `herdr` pane CLI.
 *
 * Every function returns `null`/`false` instead of throwing: the sidebar must keep
 * working (overlay mode) on machines without herdr, and a mid-session herdr restart
 * must never take the pi session down with it.
 */

/** Label we give our pane so it can be found again across sessions. */
export const PANE_LABEL = "pi-sidebar";

/** Minimum pane width we will ever request (keeps the HUD readable). */
export const MIN_PANE_WIDTH = 16;
/**
 * Upper clamp for a requested pane width. Raised from 60 so a wide pane can show
 * full, unwrapped statusline/text; herdr clamps to the tab area if smaller.
 */
export const MAX_PANE_WIDTH = 120;

export interface HerdrPaneInfo {
	pane_id: string;
	tab_id: string;
	workspace_id: string;
	label?: string;
	cwd?: string;
	focused?: boolean;
}

export interface HerdrLayout {
	areaWidth: number;
	paneWidth: number | null;
}

/** `HERDR_BIN_PATH` is herdr's documented contract; no PATH guessing. */
export function herdrBinary(): string | null {
	const fromEnv = process.env.HERDR_BIN_PATH;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	return null;
}

export function currentPaneId(): string | null {
	return process.env.HERDR_PANE_ID ?? null;
}

export function currentTabId(): string | null {
	return process.env.HERDR_TAB_ID ?? null;
}

/** True only inside a herdr pane that also exposes its binary. */
export function isHerdrSession(): boolean {
	return Boolean(herdrBinary() && currentPaneId());
}

function run(bin: string, args: string[], timeout = 5000): string | null {
	try {
		return execFileSync(bin, args, {
			encoding: "utf8",
			timeout,
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		});
	} catch {
		return null;
	}
}

// SAFETY: herdr's stdout is the CLI contract; it is JSON, but a malformed or
// partially-written response must degrade to "unknown" rather than throw.
interface HerdrEnvelope {
	result?: {
		panes?: HerdrPaneInfo[];
		pane?: HerdrPaneInfo;
		layout?: {
			area?: { width?: number };
			panes?: Array<{ pane_id?: string; rect?: { width?: number } }>;
		};
	};
}

function parseEnvelope(raw: string | null): HerdrEnvelope | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as HerdrEnvelope;
	} catch {
		return null;
	}
}

export function listPanes(bin: string): HerdrPaneInfo[] {
	const parsed = parseEnvelope(run(bin, ["pane", "list"]));
	const panes = parsed?.result?.panes;
	return Array.isArray(panes) ? panes : [];
}

/** Tab area width plus the width of one specific pane (null when absent). */
export function readLayout(bin: string, paneId: string): HerdrLayout | null {
	const parsed = parseEnvelope(run(bin, ["pane", "layout", "--pane", paneId]));
	const layout = parsed?.result?.layout;
	if (!layout) return null;
	const areaWidth = Number(layout.area?.width ?? 0);
	if (!areaWidth) return null;
	const match = layout.panes?.find((pane) => pane?.pane_id === paneId);
	return {
		areaWidth,
		paneWidth: match?.rect?.width ?? null,
	};
}

/** Existing sidebar pane in this tab, if a previous session already opened one. */
export function findSidebarPane(bin: string, tabId: string): HerdrPaneInfo | null {
	return (
		listPanes(bin).find(
			(pane) => pane.tab_id === tabId && pane.label === PANE_LABEL,
		) ?? null
	);
}

export function clampPaneWidth(width: number): number {
	if (!Number.isFinite(width)) return 32;
	return Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, Math.round(width)));
}

/**
 * Fraction of the split source pane that keeps its current size, so the *new*
 * pane ends up exactly `targetWidth` columns wide.
 *
 * herdr's `--ratio` is the fraction of the **left/source** pane (verified: 0.5 →
 * 76/76, 0.4 → 61/91 on a 152-column tab). Clamped away from 0/1 because herdr
 * collapses degenerate splits.
 */
export function computeSplitRatio(
	sourcePaneWidth: number,
	targetWidth: number,
): number {
	if (sourcePaneWidth <= 0) return 0.5;
	const ratio = (sourcePaneWidth - clampPaneWidth(targetWidth)) / sourcePaneWidth;
	return Math.max(0.15, Math.min(0.9, Number(ratio.toFixed(6))));
}

/** Split the calling pane to the right, leaving focus on pi. Returns the new id. */
export function splitPane(
	bin: string,
	cwd: string,
	targetWidth: number,
): string | null {
	const source = currentPaneId();
	if (!source) return null;
	const layout = readLayout(bin, source);
	const sourceWidth = layout?.paneWidth ?? layout?.areaWidth ?? 0;
	if (!sourceWidth) return null;

	const ratio = computeSplitRatio(sourceWidth, targetWidth);
	const parsed = parseEnvelope(
		run(bin, [
			"pane",
			"split",
			"--current",
			"--direction",
			"right",
			"--cwd",
			cwd,
			"--no-focus",
			"--ratio",
			String(ratio),
		]),
	);
	return parsed?.result?.pane?.pane_id ?? null;
}

export function renamePane(bin: string, paneId: string, label: string): boolean {
	return run(bin, ["pane", "rename", paneId, label]) !== null;
}

/** Args with spaces are quoted for the pane's shell (PowerShell and POSIX both). */
function shellQuote(arg: string): string {
	return /\s/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Spawn the standalone renderer inside the pane. Passed as argv (herdr's
 * `pane run <id> <COMMAND>...` contract) rather than one concatenated string.
 */
export function runRendererInPane(
	bin: string,
	paneId: string,
	nodeBinary: string,
	rendererPath: string,
	snapshotPath: string,
	pollMs: number,
): boolean {
	const argv = [
		shellQuote(nodeBinary),
		shellQuote(rendererPath),
		"--snapshot",
		shellQuote(snapshotPath),
		"--poll",
		String(pollMs),
	];
	return run(bin, ["pane", "run", paneId, ...argv]) !== null;
}

export function closePane(bin: string, paneId: string): boolean {
	return run(bin, ["pane", "close", paneId]) !== null;
}
