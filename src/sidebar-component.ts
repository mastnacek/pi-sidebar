import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TUI,
	sliceByColumn,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getActiveConfig } from "./config.js";
import { formatProjectPath, getGitInfo } from "./git.js";
import {
	contextBar,
	formatResetTime,
	getKimiQuotas,
	getZaiQuotas,
} from "./quota.js";
import {
	THINKING_EMOJI,
	THINKING_TOKEN,
	formatCost,
	formatPercent,
	formatTokens,
	formatTokensCompact,
	getSessionStats,
	isAutoCompactEnabled,
} from "./stats.js";

const BORDER_CHARS = {
	line: "│ ",
	double: "║ ",
	dotted: "┆ ",
	space: "  ",
	none: "",
};

export class SidebarComponent implements Component {
	private tui: TUI;
	private pi: ExtensionAPI;
	private ctx: ExtensionContext;
	private theme: Theme;
	private sessionStartIso: string;

	constructor(tui: TUI, pi: ExtensionAPI, ctx: ExtensionContext, theme: Theme) {
		this.tui = tui;
		this.pi = pi;
		this.ctx = ctx;
		this.theme = theme;
		this.sessionStartIso = new Date().toISOString();
	}

	updateContext(ctx: ExtensionContext): void {
		this.ctx = ctx;
	}

	updateTheme(theme: Theme): void {
		this.theme = theme;
	}

	invalidate(): void {
		// Cleared on next render
	}

	dispose(): void {
		// Cleanup if needed
	}

	private wrapText(text: string, maxWidth: number): string[] {
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

			if (!foundBreak) {
				sliceLen = maxWidth;
			}

			result.push(current.slice(0, sliceLen));
			current = current.slice(sliceLen);
		}

		return result;
	}

	render(width: number): string[] {
		const config = getActiveConfig();
		if (!config.enabled) return [];

		const termHeight = this.tui.terminal.rows;
		const borderPrefix = BORDER_CHARS[config.borderStyle] ?? BORDER_CHARS.line;
		const borderColWidth = visibleWidth(borderPrefix);
		const innerWidth = Math.max(8, width - borderColWidth);

		const th = this.theme;
		const accent = (s: string) => th.fg("accent", s);
		const muted = (s: string) => th.fg("muted", s);
		const dim = (s: string) => th.fg("dim", s);
		const success = (s: string) => th.fg("success", s);
		const warning = (s: string) => th.fg("warning", s);
		const error = (s: string) => th.fg("error", s);

		const header = (title: string, icon?: string) => {
			const label = icon ? `${icon} ${title}` : title;
			const lineLen = Math.max(1, innerWidth - visibleWidth(label) - 4);
			return `${accent(`── ${label} `)}${dim("─".repeat(lineLen))}`;
		};

		const topLines: string[] = [];
		const bottomLines: string[] = [];

		const stats = getSessionStats(this.ctx);
		const model = this.ctx.model;
		const usage = this.ctx.getContextUsage();
		const percentValue = usage?.percent ?? stats.contextPercent;
		const isNearCompaction = percentValue !== null && percentValue >= 80;
		const isImminentCompaction = percentValue !== null && percentValue >= 90;

		const ctxColor: (s: string) => string = isImminentCompaction
			? error
			: isNearCompaction
				? warning
				: percentValue !== null && percentValue > 60
					? accent
					: success;

		// =========================================================================
		// PRESET: DETAILED (Clean, structured dashboard)
		// =========================================================================
		if (config.preset === "detailed") {
			// 1. Session Section
			if (config.showSession) {
				topLines.push(header("SESSION"));
				const sessionName = this.ctx.sessionManager.getSessionName();
				const sessionTitle = sessionName
					? `🏷️ ${sessionName}`
					: `New session • ${this.sessionStartIso.slice(11, 16)}`;
				for (const line of this.wrapText(sessionTitle, innerWidth)) {
					topLines.push(muted(line));
				}
				topLines.push("");
			}

			// 2. Model & Thinking Section
			if (config.showModel && model) {
				topLines.push(header("MODEL"));
				const modelId = model.id || "no-model";
				const providerTag = model.provider ? `(${model.provider})` : "";
				topLines.push(accent(modelId));
				if (providerTag) topLines.push(dim(providerTag));

				if (model.reasoning) {
					const level = this.pi.getThinkingLevel() || "off";
					const emoji = THINKING_EMOJI[level] ?? "🧠";
					const token = THINKING_TOKEN[level] ?? "thinkingOff";
					topLines.push(th.fg(token, `${emoji} thinking: ${level}`));
				}
				topLines.push("");
			}

			// 3. Context & Cost Section
			if (config.showContext) {
				topLines.push(header("CONTEXT"));

				const barW = Math.max(6, Math.min(10, innerWidth - 6));
				const autoStr = isAutoCompactEnabled(this.ctx.cwd) ? " (auto)" : "";
				const bar = ctxColor(contextBar(percentValue, barW));
				const pctStr = percentValue === null ? "?%" : `${percentValue.toFixed(1)}%`;
				topLines.push(`${bar} ${ctxColor(pctStr)}${dim(autoStr)}`);

				const tokensUsed =
					stats.contextTokens ?? stats.totalInputTokens + stats.totalOutputTokens;
				const windowStr = `${formatTokensCompact(tokensUsed)} / ${formatTokensCompact(stats.contextWindow)} tokens`;
				topLines.push(muted(windowStr));

				const costStr = `💰 $${(stats.totalCost || 0).toFixed(stats.totalCost < 0.01 ? 4 : 3)} spent`;
				topLines.push(warning(costStr));
				topLines.push("");
			}

			// 4. Token & Cache Breakdown Section
			if (config.showCache) {
				topLines.push(header("TOKENS & CACHE"));
				const inOutStr = `↑ ${formatTokensCompact(stats.totalInputTokens)} in  ↓ ${formatTokensCompact(stats.totalOutputTokens)} out`;
				topLines.push(dim(inOutStr));

				if (stats.totalCacheRead > 0 || stats.totalCacheWrite > 0) {
					let cacheStr = `📦 ${formatTokensCompact(stats.totalCacheRead)} cache`;
					if (stats.cacheHitRate !== undefined) {
						cacheStr += ` 🎯${stats.cacheHitRate.toFixed(0)}% hit`;
					}
					topLines.push(muted(cacheStr));
				}
				topLines.push("");
			}

			// 5. Vendor Quota Section (Kimi & Z.ai)
			if (config.showQuota) {
				const isKimi = model?.provider === "kimi-coding";
				const isZai =
					model?.provider === "zai-coding-cn" || model?.provider === "zai-coding";

				const kimi = getKimiQuotas();
				const zai = getZaiQuotas();

				if (isKimi && kimi?.usage) {
					topLines.push(header("QUOTA"));
					const used = Number(kimi.usage.used ?? 0);
					const limit = Number(kimi.usage.limit ?? 0);
					const pct = limit > 0 ? (used / limit) * 100 : 0;
					const qColor = pct > 90 ? error : pct > 70 ? warning : success;
					const bar = qColor(contextBar(pct, 6));

					topLines.push(`Týden: ${bar} ${qColor(`${pct.toFixed(0)}%`)}`);
					topLines.push(dim(`Rst: ${formatResetTime(kimi.usage.resetTime)}`));

					const detail5h = kimi.limits?.[0]?.detail;
					if (detail5h) {
						const u5 = Number(detail5h.used ?? 0);
						const l5 = Number(detail5h.limit ?? 0);
						const p5 = l5 > 0 ? (u5 / l5) * 100 : 0;
						const c5 = p5 > 90 ? error : p5 > 70 ? warning : success;
						topLines.push(`5h: ${c5(contextBar(p5, 6))} ${c5(`${p5.toFixed(0)}%`)}`);
					}
					topLines.push("");
				} else if (isZai && zai?.limits?.length) {
					topLines.push(header("QUOTA"));
					const zLimits = zai.limits.filter((l) => l.type === "TOKENS_LIMIT");
					const fiveHour = zLimits.find((l) => l.unit === 3) ?? zLimits[0];
					const weekly = zLimits.find((l) => l.unit === 6) ?? zLimits[1];

					if (fiveHour) {
						const p = fiveHour.percentage ?? 0;
						const c = p > 90 ? error : p > 70 ? warning : success;
						topLines.push(`5h: ${c(contextBar(p, 6))} ${c(`${p}%`)}`);
					}
					if (weekly) {
						const p = weekly.percentage ?? 0;
						const c = p > 90 ? error : p > 70 ? warning : success;
						topLines.push(`Týden: ${c(contextBar(p, 6))} ${c(`${p}%`)}`);
					}
					const search = zai.limits.find((l) => l.type === "TIME_LIMIT");
					if (search && typeof search.usage === "number") {
						topLines.push(
							dim(`Hledání: ${search.currentValue ?? 0}/${search.usage}`),
						);
					}
					topLines.push("");
				}
			}

			// 6. LSP & Tools Section
			if (config.showLsp) {
				topLines.push(header("LSP"));
				let activeTools: string[] = [];
				try {
					activeTools = this.pi.getActiveTools();
				} catch {
					// Non-fatal
				}
				const lspTools = activeTools.filter((t: string) => {
					const lower = t.toLowerCase();
					return (
						lower.includes("lsp") ||
						lower.includes("lens") ||
						lower.includes("ast_grep")
					);
				});

				if (lspTools.length > 0) {
					topLines.push(success(`Active (${lspTools.length} tools)`));
				} else {
					topLines.push(muted("LSPs disabled"));
				}
				topLines.push("");
			}
		}

		// =========================================================================
		// PRESET: COMPACT (Minimal vertical lines)
		// =========================================================================
		else if (config.preset === "compact") {
			if (config.showSession) {
				const sessionName = this.ctx.sessionManager.getSessionName();
				const title = sessionName ? `🏷️ ${sessionName}` : "Session";
				topLines.push(muted(title));
			}

			if (config.showModel && model) {
				const level = this.pi.getThinkingLevel() || "off";
				const emoji = THINKING_EMOJI[level] ?? "🧠";
				topLines.push(accent(`${model.id} • ${emoji}`));
			}

			if (config.showContext) {
				const pctStr = percentValue === null ? "?%" : `${percentValue.toFixed(0)}%`;
				const costStr = `$${(stats.totalCost || 0).toFixed(2)}`;
				topLines.push(
					`${ctxColor(pctStr)} ${dim("│")} ${warning(costStr)} ${dim("│")} ${muted(formatTokensCompact(stats.totalInputTokens + stats.totalOutputTokens))}`,
				);
				topLines.push("");
			}
		}

		// =========================================================================
		// PRESET: OPENCODE (Standard OpenCode layout)
		// =========================================================================
		else {
			// 1. Session Section
			if (config.showSession) {
				const sessionName = this.ctx.sessionManager.getSessionName();
				const sessionTitle = sessionName
					? `Session - ${sessionName}`
					: `New session - ${this.sessionStartIso}`;
				const wrappedSession = this.wrapText(sessionTitle, innerWidth);
				for (const line of wrappedSession) {
					topLines.push(muted(line));
				}
				topLines.push("");
			}

			// 2. Context Section
			if (config.showContext) {
				topLines.push(accent("Context"));

				const tokensStr = formatTokens(
					stats.contextTokens ?? stats.totalInputTokens + stats.totalOutputTokens,
				);
				topLines.push(muted(tokensStr));

				const percentStr = formatPercent(stats.contextPercent);
				topLines.push(muted(percentStr));

				const costStr = formatCost(stats.totalCost);
				topLines.push(muted(costStr));

				topLines.push("");
			}

			// 3. LSP Section
			if (config.showLsp) {
				topLines.push(accent("LSP"));

				let activeTools: string[] = [];
				try {
					activeTools = this.pi.getActiveTools();
				} catch {
					// Non-fatal fallback
				}

				const lspTools = activeTools.filter((t: string) => {
					const lower = t.toLowerCase();
					return (
						lower.includes("lsp") ||
						lower.includes("lens") ||
						lower.includes("ast_grep")
					);
				});

				if (lspTools.length > 0) {
					topLines.push(muted(`Active (${lspTools.length} tools)`));
				} else {
					topLines.push(muted("LSPs are disabled"));
				}
				topLines.push("");
			}
		}

		// =========================================================================
		// Bottom Section: Git & Path
		// =========================================================================
		if (config.showGit) {
			const cwd = this.ctx.cwd;
			const gitInfo = getGitInfo(cwd);
			const formattedPath = formatProjectPath(cwd, gitInfo.branch);

			if (config.preset === "detailed") {
				bottomLines.push(header("WORKSPACE"));
				const wrappedPath = this.wrapText(`📁 ${formattedPath}`, innerWidth);
				for (const line of wrappedPath) {
					bottomLines.push(th.fg("customMessageLabel", line));
				}

				if (gitInfo.branch) {
					const dirtyIcon = gitInfo.dirty ? "● dirty" : "○ clean";
					const dirtyColor = gitInfo.dirty ? warning : success;
					let gitMeta = `🌿 ${gitInfo.branch} ${dirtyColor(dirtyIcon)}`;
					if (gitInfo.ahead > 0) gitMeta += dim(` ▸${gitInfo.ahead}`);
					if (gitInfo.behind > 0) gitMeta += dim(` ◂${gitInfo.behind}`);
					bottomLines.push(gitMeta);
				}
			} else {
				const wrappedPath = this.wrapText(formattedPath, innerWidth);
				for (const line of wrappedPath) {
					bottomLines.push(th.fg("customMessageLabel", line));
				}
			}
			bottomLines.push("");
		}

		// =========================================================================
		// Branding Footer with Herdr-style collapse indicator
		// =========================================================================
		let brandingText = "• OpenCode 1.18.26";
		if (config.branding === "pi") {
			brandingText = "• Pi Agent v0.84.4";
		} else if (config.branding === "custom" && config.customBrandingText) {
			brandingText = `• ${config.customBrandingText}`;
		}

		const brandStr = success(brandingText);
		const collapseHint = dim("«");
		const spaceAvail =
			innerWidth - visibleWidth(brandingText) - visibleWidth("«");
		const footerLine =
			spaceAvail > 1
				? brandStr + " ".repeat(spaceAvail) + collapseHint
				: brandStr;
		bottomLines.push(footerLine);

		// =========================================================================
		// Assemble Vertical Layout
		// =========================================================================
		const totalContentRows = topLines.length + bottomLines.length;
		const targetHeight =
			termHeight > 0 ? termHeight : Math.max(totalContentRows, 24);
		const emptyMiddleRows = Math.max(0, targetHeight - totalContentRows);

		const allContentLines: string[] = [
			...topLines,
			...Array.from({ length: emptyMiddleRows }, () => ""),
			...bottomLines,
		];

		const constrainedLines =
			termHeight > 0 && allContentLines.length > termHeight
				? allContentLines.slice(0, termHeight)
				: allContentLines;

		return constrainedLines.map((content) => {
			const border =
				config.borderStyle === "none" ? "" : th.fg("border", borderPrefix);
			const lineWithoutBorder = content;
			const lineVisWidth = visibleWidth(lineWithoutBorder);
			const padLen = Math.max(0, innerWidth - lineVisWidth);
			const paddedContent = lineWithoutBorder + " ".repeat(padLen);
			const fullLine = border + paddedContent;

			return visibleWidth(fullLine) > width
				? sliceByColumn(fullLine, 0, width, true)
				: fullLine;
		});
	}
}
