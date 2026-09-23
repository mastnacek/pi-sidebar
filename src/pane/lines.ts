import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	type SkillBridge,
	type SkillsPanelStyle,
	renderSkillsPanel,
} from "../skills-tab.js";
import { renderStatusLine } from "../statusline.js";
import { type TabHitRange, renderTabBar } from "../tabs.js";
import type { GitInfo, SidebarTab, SkillStateSnapshot } from "../types.js";

/**
 * Theme accessor handed in by the extension. Tokens match `Theme.fg` names
 * (`accent`, `muted`, `dim`, `success`, `warning`, `error`, …), so the same
 * strings used by the overlay keep working here.
 */
export type PaneColor = (token: string, text: string) => string;

export interface PaneViewInput {
	/** Total pane width in columns, border included. */
	width: number;
	bridge: SkillBridge;
	/** Which sidebar face to mirror: the skill HUD or the status summary. */
	face?: "skills" | "status";
	/** Tab marked active in the pane's own tab strip. */
	activeTab?: SidebarTab;
	/** Session name shown in status face. */
	sessionTitle?: string | null;
	modelId?: string | null;
	modelProvider?: string | null;
	modelReasoning?: boolean;
	thinkingLevel?: string | null;
	contextPercent: number | null;
	contextWindow?: number | null;
	autoCompactEnabled?: boolean;
	cost?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cacheHitRate?: number;
	usingSubscription?: boolean;
	showSession?: boolean;
	showGit?: boolean;
	git: GitInfo;
	cwd: string;
	color: PaneColor;
	now?: number;
}

/** Same gutter the overlay uses, so both faces look identical. */
const BORDER = "│ ";

function wrapText(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [text];
	if (visibleWidth(text) <= maxWidth) return [text];

	const result: string[] = [];
	let current = text;

	while (current.length > 0) {
		if (visibleWidth(current) <= maxWidth) {
			result.push(current);
			break;
		}

		let sliceLen = maxWidth;
		let foundBreak = false;

		for (
			let i = Math.min(current.length, maxWidth);
			i > Math.max(1, maxWidth - 10);
			i--
		) {
			const char = current[i - 1];
			if (
				char === "\\" ||
				char === "/" ||
				char === ":" ||
				char === " " ||
				char === "-" ||
				char === "•" ||
				char === "|"
			) {
				sliceLen = i;
				foundBreak = true;
				break;
			}
		}

		if (!foundBreak) sliceLen = maxWidth;
		result.push(current.slice(0, sliceLen));
		current = current.slice(sliceLen);
	}

	return result;
}

/** Rendered pane frame plus the clickable tab ranges it produced. */
export interface PaneFrame {
	lines: string[];
	tabHits: TabHitRange[];
}

/**
 * Build the pane face: tab strip, then the skill HUD (skills face only), then
 * the statusline-parity telemetry block. There is no overlay anymore, so no
 * shortcut hints are drawn — the pane never receives those key chords.
 */
export function buildPaneFrame(input: PaneViewInput): PaneFrame {
	const width = Math.max(8, Math.floor(input.width));
	const innerWidth = Math.max(4, width - visibleWidth(BORDER));
	const { color } = input;
	const now = input.now ?? Date.now();

	const accent = (s: string) => color("accent", s);
	const muted = (s: string) => color("muted", s);
	const dim = (s: string) => color("dim", s);
	const success = (s: string) => color("success", s);
	const warning = (s: string) => color("warning", s);
	const error = (s: string) => color("error", s);

	const content: string[] = [];

	// 0. Tab strip — Status | Skills bar. Switching is driven by `/sidebar tab`,
	// ctrl+shift+t, or a click; the hit ranges travel in the snapshot so an
	// interactive renderer can map clicks without re-deriving layout.
	const activeTab: SidebarTab =
		input.activeTab ?? (input.face === "status" ? "status" : "skills");
	const tabBar = renderTabBar(activeTab, innerWidth, {
		accent,
		muted,
		dim,
		// No theme here: emphasise the active tab with the accent colour instead.
		bold: (s: string) => accent(s),
	});
	content.push(tabBar.line);
	content.push(dim("─".repeat(Math.max(1, innerWidth))));
	content.push("");

	// 1. Skill usage HUD (pi-plugin-dev tracker snapshot off the event bus) —
	// skills face only; the status face starts at the statusline block.
	if (input.face !== "status") {
		content.push(
			...renderSkillsPanel(
				input.bridge,
				innerWidth,
				{ accent, muted, dim, success, warning, error } satisfies SkillsPanelStyle,
				(text: string, maxWidth: number) => wrapText(text, maxWidth),
				now,
			),
		);
		content.push("");
	}

	// 2. Statusline-parity telemetry (cwd, git, session, context, cost, token
	//    totals, cache, provider + model + thinking emoji).
	content.push(
		...renderStatusLine({
			cwd: input.cwd,
			git: input.git,
			color,
			innerWidth,
			sessionName: input.sessionTitle ?? null,
			modelId: input.modelId ?? null,
			modelProvider: input.modelProvider ?? null,
			modelReasoning: input.modelReasoning,
			thinkingLevel: input.thinkingLevel ?? null,
			contextPercent: input.contextPercent,
			contextWindow: input.contextWindow ?? 0,
			autoCompactEnabled: input.autoCompactEnabled,
			cost: input.cost,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
			cacheRead: input.cacheRead,
			cacheWrite: input.cacheWrite,
			cacheHitRate: input.cacheHitRate,
			usingSubscription: input.usingSubscription,
			showSession: input.showSession !== false,
			showGit: input.showGit !== false,
		}),
	);

	const lines = content.map((line) => {
		// Empty ellipsis: content is already wrapped to `innerWidth`, so this only
		// guards against a stray overflow without painting `...` over the text.
		const trimmed = truncateToWidth(line, innerWidth, "");
		const padLen = Math.max(0, innerWidth - visibleWidth(trimmed));
		return BORDER + trimmed + " ".repeat(padLen);
	});

	return { lines, tabHits: tabBar.hits };
}

/** Convenience wrapper for callers that only need the painted lines. */
export function buildPaneLines(input: PaneViewInput): string[] {
	return buildPaneFrame(input).lines;
}

/** Convenience for the controller: the current skill snapshot, if any. */
export function currentSkillState(bridge: SkillBridge): SkillStateSnapshot | null {
	return bridge.getState();
}
