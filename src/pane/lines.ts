import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatProjectPath } from "../git.js";
import { contextBar } from "../quota.js";
import {
	type SkillBridge,
	type SkillsPanelStyle,
	renderSkillsPanel,
} from "../skills-tab.js";
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
	thinkingLevel?: string | null;
	contextPercent: number | null;
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
 * Build the pane face: tab strip, then skill HUD (or session line), then Model,
 * Context, Git and Shortcuts. Everything else (quota, tokens/cache, MCP, LSP,
 * extensions, branding) is intentionally absent — see the Skills-tab decision.
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

	const header = (title: string, icon?: string): string => {
		const label = icon ? `${icon} ${title}` : title;
		const lineLen = Math.max(1, innerWidth - visibleWidth(label) - 4);
		return `${accent(`── ${label} `)}${dim("─".repeat(lineLen))}`;
	};

	const content: string[] = [];

	// 0. Tab strip — mirrors the overlay's Status | Skills bar. Switching is driven
	// by `/sidebar tab` and ctrl+shift+t; the hit ranges travel in the snapshot so
	// an interactive renderer can map clicks without re-deriving layout.
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

	// 1. Skill usage HUD (pi-plugin-dev tracker snapshot off the event bus), or a
	// plain session line when mirroring the status face.
	if (input.face === "status") {
		content.push(
			muted(
				truncateToWidth(
					input.sessionTitle ? `🏷️ ${input.sessionTitle}` : "Session",
					innerWidth,
				),
			),
		);
	} else {
		content.push(
			...renderSkillsPanel(
				input.bridge,
				innerWidth,
				{ accent, muted, dim, success, warning, error } satisfies SkillsPanelStyle,
				(text: string, maxWidth: number) => wrapText(text, maxWidth),
				now,
			),
		);
	}
	content.push("");

	// 2. Selected model + thinking level.
	content.push(header("MODEL", "🤖"));
	if (input.modelId) {
		content.push(accent(truncateToWidth(input.modelId, innerWidth)));
		if (input.modelProvider) {
			content.push(dim(truncateToWidth(`(${input.modelProvider})`, innerWidth)));
		}
		content.push(
			muted(
				truncateToWidth(
					`thinking: ${input.thinkingLevel ?? "off"}`,
					innerWidth,
				),
			),
		);
	} else {
		content.push(dim("(no model)"));
	}
	content.push("");

	// 3. Context bar — percent only, no token/cost telemetry.
	content.push(header("CONTEXT", "📊"));
	const barW = Math.max(6, Math.min(10, innerWidth - 8));
	const pct =
		input.contextPercent === null
			? "?%"
			: `${input.contextPercent.toFixed(0)}%`;
	const barColor =
		input.contextPercent !== null && input.contextPercent >= 90
			? error
			: input.contextPercent !== null && input.contextPercent >= 80
				? warning
				: accent;
	content.push(
		`${barColor(contextBar(input.contextPercent, barW))} ${barColor(pct)}`,
	);
	content.push("");

	// 4. Git / workspace.
	content.push(header("GIT", "🌿"));
	const path = formatProjectPath(input.cwd, input.git.branch);
	for (const line of wrapText(`📁 ${path}`, innerWidth)) {
		content.push(color("customMessageLabel", line));
	}
	if (input.git.branch) {
		const dirtyIcon = input.git.dirty ? "● změny" : "○ čisté";
		const dirtyColor = input.git.dirty ? warning : success;
		let meta = `🌿 ${input.git.branch} ${dirtyColor(dirtyIcon)}`;
		if (input.git.ahead > 0) meta += dim(` ▸${input.git.ahead}`);
		if (input.git.behind > 0) meta += dim(` ◂${input.git.behind}`);
		content.push(meta);
	}
	content.push("");

	// 5. Shortcuts.
	content.push(header("ZKRATKY", "⌨️"));
	content.push(dim("⌨️ ctrl+shift+b    « minimal pruh / zpět"));
	content.push(dim("⌨️ ctrl+shift+←/→  šířka (±4)"));

	const lines = content.map((line) => {
		const trimmed = truncateToWidth(line, innerWidth);
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
