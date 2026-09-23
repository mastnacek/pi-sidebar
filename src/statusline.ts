import { visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { contextBar } from "./quota.js";
import {
	THINKING_EMOJI,
	THINKING_TOKEN,
	formatCostRaw,
	formatTokensCompact,
} from "./stats.js";
import type { GitInfo } from "./types.js";

/**
 * Statusline-parity renderer for the sidebar pane.
 *
 * The pane must not invent its own telemetry formatting: the user reads the real
 * statusline (eldritch-footer `full` preset / pi's footer) and expects the pane
 * to show the *same* numbers with the *same* precision:
 *
 *   - context: `percent.toFixed(1)%/<window-tokens>[(auto)]` — never rounded
 *   - cost:    `$0.000` / 4dp under a cent / 3dp under a dollar / else 2dp
 *   - tokens:  compact `k`/`M` (`formatTokensCompact`)
 *   - git:     `🌿 branch ●dirty|○clean ▸N ahead ◂N behind`
 *   - model:   `(provider) id • <thinking emoji> <level>`
 *
 * Segments are wrapped, never truncated: a long `(provider) model`, path or
 * session name is split across lines so a wide pane shows the full text instead
 * of `…`.
 *
 * Takes a `(token, text) => string` color accessor (not a `Theme`) so the pane
 * (`PaneColor`) can drive it directly.
 */

export interface StatusLineData {
	cwd: string;
	git: GitInfo;
	color: (token: string, text: string) => string;
	innerWidth: number;
	sessionName?: string | null;
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
	/** Kimi Coding is subscription-backed despite API-key auth. */
	usingSubscription?: boolean;
	showSession?: boolean;
	showGit?: boolean;
}

/** A plain-text fragment plus the closure that colors it. */
interface Segment {
	text: string;
	render: (text: string) => string;
}

/** A logical statusline group (one `│`-separated column) made of colored parts. */
type Group = Segment[];

/** `~`-shortened cwd, exactly like the statusline's `formatCwd`. */
export function formatCwdShort(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	if (!home) return cwd;
	const rCwd = resolve(cwd);
	const rHome = resolve(home);
	if (rCwd === rHome) return "~";
	if (rCwd.startsWith(rHome + sep)) return `~${sep}${rCwd.slice(rHome.length + 1)}`;
	return cwd;
}

/**
 * Split plain (uncolored) text into chunks of at most `width` visible columns.
 * Code-point aware, so emoji are never cut in half.
 */
export function wrapPlain(text: string, width: number): string[] {
	if (width <= 0 || visibleWidth(text) <= width) return [text];
	const chunks: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const char of text) {
		const charWidth = visibleWidth(char);
		if (current && currentWidth + charWidth > width) {
			chunks.push(current);
			current = "";
			currentWidth = 0;
		}
		current += char;
		currentWidth += charWidth;
	}
	if (current) chunks.push(current);
	return chunks;
}

const renderGroup = (group: Group): string =>
	group.map((segment) => segment.render(segment.text)).join("");

/**
 * Pack logical groups onto lines of at most `width` visible columns. Groups are
 * separated by `sep`; a group is never split by a separator, and a group that
 * cannot fit is wrapped over consecutive lines instead of being truncated.
 */
function packGroups(groups: readonly Group[], sep: string, width: number): string[] {
	const lines: string[] = [];
	let current = "";
	const flush = (): void => {
		if (current) {
			lines.push(current);
			current = "";
		}
	};

	for (const group of groups) {
		const rendered = renderGroup(group);
		if (visibleWidth(rendered) <= width) {
			const candidate = current ? current + sep + rendered : rendered;
			if (visibleWidth(candidate) <= width) {
				current = candidate;
				continue;
			}
			flush();
			current = rendered;
			continue;
		}

		// Group wider than the whole line: wrap its parts, keeping colors intact.
		flush();
		let line = "";
		const pushLine = (): void => {
			if (line) {
				lines.push(line);
				line = "";
			}
		};
		for (const segment of group) {
			const part = segment.render(segment.text);
			if (visibleWidth(line) + visibleWidth(part) <= width) {
				line += part;
				continue;
			}
			pushLine();
			if (visibleWidth(part) <= width) {
				line = part;
				continue;
			}
			for (const chunk of wrapPlain(segment.text, width)) {
				lines.push(segment.render(chunk));
			}
		}
		pushLine();
	}

	flush();
	return lines;
}

/** Context color token, mirroring the statusline thresholds. */
function contextToken(percent: number | null): string {
	if (percent === null) return "success";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	if (percent > 60) return "accent";
	return "success";
}

export function renderStatusLine(data: StatusLineData): string[] {
	const width = Math.max(1, data.innerWidth);
	const color = data.color;
	const accent = (s: string) => color("accent", s);
	const muted = (s: string) => color("muted", s);
	const dim = (s: string) => color("dim", s);
	const success = (s: string) => color("success", s);
	const warning = (s: string) => color("warning", s);
	const sep = dim(" │ ");
	const space: Segment = { text: " ", render: (s) => s };

	const percentValue = data.contextPercent;
	const contextWindow = data.contextWindow ?? 0;
	const ctxToken = contextToken(percentValue);

	// ---- line A: location + git + session ----
	const loc: Group[] = [[{ text: `📁 ${formatCwdShort(data.cwd)}`, render: muted }]];
	if (data.showGit !== false && data.git.branch) {
		const dirtyToken = data.git.dirty ? "warning" : "success";
		const branchTail = data.git.ahead > 0 || data.git.behind > 0 ? "" : "";
		const branchText = `🌿 ${data.git.branch} ${data.git.dirty ? "●" : "○"}${branchTail}`;
		const ahead = data.git.ahead > 0 ? ` ▸${data.git.ahead} ahead` : "";
		const behind = data.git.behind > 0 ? ` ◂${data.git.behind} behind` : "";
		loc.push([
			{
				text: branchText,
				// Keep branch + dirty glyph together, but color the glyph itself.
				render: (s) => {
					const last = s.slice(-1);
					if (last === "●" || last === "○") {
						return success(s.slice(0, -1)) + color(dirtyToken, last);
					}
					return success(s);
				},
			},
			...[
				ahead && { text: ahead, render: dim },
				behind && { text: behind, render: dim },
			].filter((segment): segment is Segment => Boolean(segment)),
		]);
	}
	if (data.showSession !== false && data.sessionName) {
		loc.push([
			{
				text: `🏷️ ${data.sessionName}`,
				render: (s) => color("customMessageLabel", s),
			},
		]);
	}

	// ---- line B/C: context + cost + tokens + cache + model ----
	const barW = Math.max(6, Math.min(14, Math.floor(width * 0.2)));
	const pct = percentValue === null ? "?" : `${percentValue.toFixed(1)}%`;
	const contextGroup: Group = [
		{ text: "📊 ", render: dim },
		{ text: contextBar(percentValue, barW), render: (s) => color(ctxToken, s) },
		space,
		{
			text: `${pct}/${formatTokensCompact(contextWindow)}`,
			render: (s) => color(ctxToken, s),
		},
	];
	if (data.autoCompactEnabled) {
		contextGroup.push({ text: " (auto)", render: dim });
	}

	const costGroup: Group = [
		{ text: `💰 $${formatCostRaw(data.cost ?? 0)}`, render: warning },
	];
	if (data.usingSubscription) costGroup.push({ text: " (sub)", render: dim });

	const stats: Group[] = [
		contextGroup,
		costGroup,
		[{ text: `⬆️ ${formatTokensCompact(data.inputTokens ?? 0)}`, render: (s) => color("mdLink", s) }],
		[{ text: `⬇️ ${formatTokensCompact(data.outputTokens ?? 0)}`, render: success }],
	];

	if ((data.cacheRead ?? 0) || (data.cacheWrite ?? 0)) {
		let cacheStr = `📦 ${formatTokensCompact(data.cacheRead ?? 0)}`;
		if (data.cacheWrite) cacheStr += ` (w:${formatTokensCompact(data.cacheWrite)})`;
		if (data.cacheHitRate !== undefined) {
			cacheStr += ` 🎯${data.cacheHitRate.toFixed(0)}%`;
		}
		stats.push([{ text: cacheStr, render: muted }]);
	}

	const modelGroup: Group = [];
	if (data.modelProvider) {
		modelGroup.push({ text: `(${data.modelProvider})`, render: dim }, space);
	}
	modelGroup.push({ text: data.modelId || "no-model", render: accent });
	if (data.modelReasoning) {
		const level = data.thinkingLevel || "off";
		const emoji = THINKING_EMOJI[level] ?? "🧠";
		const token = THINKING_TOKEN[level] ?? "thinkingOff";
		modelGroup.push(
			{ text: ` • ${emoji} `, render: dim },
			{
				text: level === "off" ? "thinking off" : level,
				render: (s) => color(token, s),
			},
		);
	}
	stats.push(modelGroup);

	return [...packGroups(loc, sep, width), ...packGroups(stats, sep, width)];
}
