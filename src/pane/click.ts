import type { TabHitRange } from "../tabs.js";
import type { SidebarTab } from "../types.js";

/**
 * Click plumbing for the pane's tab strip.
 *
 * The renderer owns no layout knowledge: it enables mouse reporting, turns a
 * left press into `{ at, column, row }` and drops it in a request file. The
 * extension — which produced `tabHits` in the first place — maps that to a tab
 * and switches it through the same `setTab()` path the slash command uses. No
 * model call, no LLM context: a click is a file write.
 */

/** The strip is the first rendered line; SGR mouse rows are 1-based. */
export const TAB_BAR_ROW = 1;

/** Width of the `│ ` gutter prepended to every pane line. */
export const BORDER_COLUMNS = 2;

export interface ClickRequest {
	/** Producer timestamp, used to ignore stale files left by a dead renderer. */
	at: number;
	/** 1-based column from the SGR mouse report. */
	column: number;
	/** 1-based row from the SGR mouse report. */
	row: number;
}

/** Reject anything that is not a plausible, recent mouse report. */
export function parseClickRequest(
	raw: unknown,
	now: number = Date.now(),
	maxAgeMs = 5000,
): ClickRequest | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Partial<ClickRequest>;
	const { at, column, row } = candidate;
	if (
		typeof at !== "number" ||
		typeof column !== "number" ||
		typeof row !== "number" ||
		!Number.isFinite(at) ||
		!Number.isFinite(column) ||
		!Number.isFinite(row)
	) {
		return null;
	}
	if (row < 1 || column < 1) return null;
	// Future timestamps are as suspicious as ancient ones (clock skew aside).
	if (at > now + 1000 || now - at > maxAgeMs) return null;
	return { at, column, row };
}

/**
 * Map a click to a tab, or `null` when it missed the strip (a gap between
 * labels, the border gutter, or another row).
 */
export function mapClickToTab(
	request: ClickRequest,
	hits: readonly TabHitRange[],
	borderColumns: number = BORDER_COLUMNS,
): SidebarTab | null {
	if (request.row !== TAB_BAR_ROW) return null;
	// SGR columns are 1-based; hit ranges are 0-based within the content area.
	const contentColumn = request.column - 1 - borderColumns;
	if (contentColumn < 0) return null;
	const hit = hits.find(
		(range) => contentColumn >= range.start && contentColumn < range.end,
	);
	return hit ? hit.id : null;
}
