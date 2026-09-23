import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarTab } from "./types.js";

export interface TabDescriptor {
	id: SidebarTab;
	/** Full label, used when the panel is wide enough. */
	label: string;
	/** Single-character fallback for very narrow panels. */
	short: string;
}

export const SIDEBAR_TABS: readonly TabDescriptor[] = [
	{ id: "status", label: "Status", short: "1" },
	{ id: "skills", label: "Skills", short: "2" },
];

export const TAB_ORDER: readonly SidebarTab[] = SIDEBAR_TABS.map((tab) => tab.id);

export function isSidebarTab(value: string): value is SidebarTab {
	return (TAB_ORDER as readonly string[]).includes(value);
}

/** Wrap-around tab cycling used by the keyboard shortcut and `/sidebar tab next`. */
export function nextTab(current: SidebarTab, delta = 1): SidebarTab {
	const index = TAB_ORDER.indexOf(current);
	if (index === -1) return TAB_ORDER[0];
	const count = TAB_ORDER.length;
	return TAB_ORDER[(((index + delta) % count) + count) % count];
}

export interface TabHitRange {
	id: SidebarTab;
	/** Column range within the panel's inner content (border prefix excluded). */
	start: number;
	/** Exclusive. */
	end: number;
}

export interface TabBarStyle {
	accent: (text: string) => string;
	muted: (text: string) => string;
	dim: (text: string) => string;
	bold: (text: string) => string;
}

export interface TabBarRender {
	line: string;
	hits: TabHitRange[];
}

const SEPARATOR = " \u2502 ";

/**
 * Build the tab bar line plus the clickable column range of every tab.
 *
 * Ranges are measured on the plain label text (ANSI styling has zero width), so
 * `handleMouse` can compare `event.x` directly. They are relative to the panel's
 * inner content; callers must add the border-prefix width before hit-testing.
 */
export function renderTabBar(
	active: SidebarTab,
	innerWidth: number,
	style: TabBarStyle,
): TabBarRender {
	const build = (compact: boolean): { line: string; hits: TabHitRange[]; width: number } => {
		let line = "";
		let col = 0;
		const hits: TabHitRange[] = [];

		for (const tab of SIDEBAR_TABS) {
			if (col > 0) {
				line += style.dim(SEPARATOR);
				col += visibleWidth(SEPARATOR);
			}
			const plain = compact ? tab.short : tab.label;
			const width = visibleWidth(plain);
			hits.push({ id: tab.id, start: col, end: col + width });
			line +=
				tab.id === active ? style.bold(style.accent(plain)) : style.muted(plain);
			col += width;
		}

		return { line, hits, width: col };
	};

	let result = build(false);
	// Too narrow for full labels — fall back to numbered tabs.
	if (result.width > innerWidth) {
		result = build(true);
	}
	// Still too narrow (extreme widths): truncate and clamp the clickable ranges.
	if (result.width > innerWidth && innerWidth > 0) {
		const line = truncateToWidth(result.line, innerWidth, "");
		const hits = result.hits
			.map((hit) => ({ ...hit, end: Math.min(hit.end, innerWidth) }))
			.filter((hit) => hit.start < innerWidth && hit.start < hit.end);
		return { line, hits };
	}

	return { line: result.line, hits: result.hits };
}
