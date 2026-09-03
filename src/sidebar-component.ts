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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getActiveConfig } from "./config.js";
import { formatProjectPath, getGitInfo } from "./git.js";
import { ringGauge } from "./gauge.js";
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
import type { FooterDataProviderLike } from "./types.js";

const BORDER_CHARS = {
	line: "│ ",
	double: "║ ",
	dotted: "┆ ",
	space: "  ",
	none: "",
};

function stripAnsi(str: string): string {
	return str
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b\([a-zA-Z]/g, "");
}

function cleanStatusText(text: string): string {
	return stripAnsi(text)
		.replace(/[\r\n\t]+/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function getWorkspaceLspServers(cwd: string, activeTools: string[]): string[] {
	const servers: string[] = [];

	const hasLotus = activeTools.some((t) =>
		t.toLowerCase().includes("lotusscript"),
	);
	const hasLens = activeTools.some(
		(t) =>
			t.toLowerCase().includes("lens") ||
			t.toLowerCase().includes("lsp_diagnostics"),
	);

	// Detect workspace project language servers
	if (
		existsSync(join(cwd, "tsconfig.json")) ||
		existsSync(join(cwd, "package.json"))
	) {
		servers.push("TypeScript");
	} else if (existsSync(join(cwd, "Cargo.toml"))) {
		servers.push("Rust (rust-analyzer)");
	} else if (existsSync(join(cwd, "go.mod"))) {
		servers.push("Go (gopls)");
	} else if (
		existsSync(join(cwd, "pyproject.toml")) ||
		existsSync(join(cwd, "requirements.txt")) ||
		existsSync(join(cwd, "setup.py"))
	) {
		servers.push("Python (pyright)");
	} else if (
		existsSync(join(cwd, "pom.xml")) ||
		existsSync(join(cwd, "build.gradle"))
	) {
		servers.push("Java (jdtls)");
	} else if (
		existsSync(join(cwd, "CMakeLists.txt")) ||
		existsSync(join(cwd, "Makefile"))
	) {
		servers.push("C/C++ (clangd)");
	}

	if (hasLotus) {
		servers.push("LotusScript");
	}
	if (hasLens && !servers.some((s) => s.includes("TypeScript"))) {
		servers.push("pi-lens (AST)");
	}

	return servers;
}

export class SidebarComponent implements Component {
	private tui: TUI;
	private pi: ExtensionAPI;
	private ctx: ExtensionContext;
	private theme: Theme;
	private sessionStartIso: string;
	private footerData: FooterDataProviderLike | null = null;

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

	updateFooterData(footerData: FooterDataProviderLike | null): void {
		this.footerData = footerData;
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
		// PRESET: MINIMAL (Narrow gauge strip — ~10 columns, indicators only)
		// =========================================================================
		if (config.preset === "minimal") {
			const center = (s: string) => {
				const padLen = Math.max(0, innerWidth - visibleWidth(s));
				return `${" ".repeat(Math.floor(padLen / 2))}${s}`;
			};

			// 1. Context ring gauge + percent
			if (config.showContext) {
				const ringW = Math.max(3, Math.min(5, innerWidth));
				for (const row of ringGauge(percentValue ?? 0, ringW, 3)) {
					topLines.push(ctxColor(center(row)));
				}
				const pctStr =
					percentValue === null ? "?%" : `${Math.round(percentValue)}%`;
				topLines.push(ctxColor(center(pctStr)));
				if (stats.totalCost > 0) {
					topLines.push(dim(center(`$${stats.totalCost.toFixed(2)}`)));
				}
				topLines.push("");
			}

			// 2. Thinking level emoji (model indicator)
			if (config.showModel && model) {
				const level = this.pi.getThinkingLevel() || "off";
				topLines.push(center(THINKING_EMOJI[level] ?? "🧠"));
				topLines.push("");
			}

			// 3. Quota mini meter (worst of the active provider's windows)
			if (config.showQuota) {
				const isKimi = model?.provider === "kimi-coding";
				const isZai =
					model?.provider === "zai-coding-cn" || model?.provider === "zai-coding";
				const qColor = (p: number) => (p > 90 ? error : p > 70 ? warning : success);

				let qPct: number | null = null;
				if (isKimi && getKimiQuotas()?.usage) {
					const kimi = getKimiQuotas()!;
					const used = Number(kimi.usage?.used ?? 0);
					const limit = Number(kimi.usage?.limit ?? 0);
					qPct = limit > 0 ? (used / limit) * 100 : 0;
				} else if (isZai && getZaiQuotas()?.limits?.length) {
					const zLimits = getZaiQuotas()!.limits!;
					qPct = Math.max(
						...zLimits
							.filter((l) => typeof l.percentage === "number")
							.map((l) => l.percentage as number),
						0,
					);
				}

				if (qPct !== null) {
					const c = qColor(qPct);
					topLines.push(c(center(contextBar(qPct, 4))));
					topLines.push(c(center(`${Math.round(qPct)}%`)));
					topLines.push("");
				}
			}

			// 4. Git status dot
			if (config.showGit) {
				const gitInfo = getGitInfo(this.ctx.cwd);
				if (gitInfo.branch) {
					topLines.push(center(gitInfo.dirty ? warning("●") : success("○")));
					if (gitInfo.ahead > 0) topLines.push(accent(center(`↑${gitInfo.ahead}`)));
					if (gitInfo.behind > 0) topLines.push(dim(center(`↓${gitInfo.behind}`)));
					topLines.push("");
				}
			}

			// 5. MCP / LSP readiness dots
			if (config.showMcp || config.showLsp) {
				let activeTools: string[] = [];
				try {
					activeTools = this.pi.getActiveTools();
				} catch {
					// Non-fatal
				}

				if (config.showMcp) {
					const hasMcp = activeTools.some(
						(t) =>
							t.startsWith("mcp_") ||
							t.startsWith("mcp__") ||
							t.startsWith("knowledge_base") ||
							t.startsWith("lotusscript_lsp"),
					);
					topLines.push(center(hasMcp ? success("●") : dim("○")));
				}
				if (config.showLsp) {
					const servers = getWorkspaceLspServers(this.ctx.cwd, activeTools);
					topLines.push(center(servers.length > 0 ? success("●") : dim("○")));
				}
			}
		}

		// =========================================================================
		// PRESET: DETAILED (Full, comprehensive vertical telemetry)
		// =========================================================================
		else if (config.preset === "detailed") {
			// 1. Session Section
			if (config.showSession) {
				topLines.push(header("RELACE", "🏷️"));
				const sessionName = this.ctx.sessionManager.getSessionName();
				const sessionTitle = sessionName
					? `🏷️ ${sessionName}`
					: `Nová relace • ${this.sessionStartIso.slice(11, 16)}`;
				for (const line of this.wrapText(sessionTitle, innerWidth)) {
					topLines.push(muted(line));
				}
				topLines.push("");
			}

			// 2. Model & Thinking Section
			if (config.showModel && model) {
				topLines.push(header("MODEL", "🤖"));
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
				topLines.push(header("KONTEXT", "📊"));

				const barW = Math.max(6, Math.min(10, innerWidth - 6));
				const autoStr = isAutoCompactEnabled(this.ctx.cwd) ? " (auto)" : "";
				const bar = ctxColor(contextBar(percentValue, barW));
				const pctStr = percentValue === null ? "?%" : `${percentValue.toFixed(1)}%`;
				topLines.push(`${bar} ${ctxColor(pctStr)}${dim(autoStr)}`);

				const tokensUsed =
					stats.contextTokens ?? stats.totalInputTokens + stats.totalOutputTokens;
				const windowStr = `${formatTokensCompact(tokensUsed)} / ${formatTokensCompact(stats.contextWindow)} tokenů`;
				topLines.push(muted(windowStr));

				const costStr = `💰 $${(stats.totalCost || 0).toFixed(stats.totalCost < 0.01 ? 4 : 3)} útrata`;
				topLines.push(warning(costStr));
				topLines.push("");
			}

			// 4. Token & Cache Breakdown Section
			if (config.showCache) {
				topLines.push(header("TOKENY A CACHE", "📦"));
				const inOutStr = `↑ ${formatTokensCompact(stats.totalInputTokens)} vstup  ↓ ${formatTokensCompact(stats.totalOutputTokens)} výstup`;
				topLines.push(dim(inOutStr));

				if (stats.totalCacheRead > 0 || stats.totalCacheWrite > 0) {
					let cacheStr = `📦 ${formatTokensCompact(stats.totalCacheRead)} cache`;
					if (stats.cacheHitRate !== undefined) {
						cacheStr += ` 🎯 ${stats.cacheHitRate.toFixed(0)}% zásah`;
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
					topLines.push(header("KVÓTY", "⚡"));
					const used = Number(kimi.usage.used ?? 0);
					const limit = Number(kimi.usage.limit ?? 0);
					const pct = limit > 0 ? (used / limit) * 100 : 0;
					const qColor = pct > 90 ? error : pct > 70 ? warning : success;
					const bar = qColor(contextBar(pct, 6));

					topLines.push(`Týden: ${bar} ${qColor(`${pct.toFixed(0)}%`)}`);
					topLines.push(dim(`Reset: ${formatResetTime(kimi.usage.resetTime)}`));

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
					topLines.push(header("KVÓTY", "⚡"));
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

			// Partition extension statuses from footerData into MCP, LSP, and other Extensions
			const globalFooter = (
				globalThis as {
					__pi_footer_data?: FooterDataProviderLike;
				}
			).__pi_footer_data;
			const activeFooterData = this.footerData ?? globalFooter ?? null;
			const extMap = activeFooterData?.getExtensionStatuses
				? activeFooterData.getExtensionStatuses()
				: null;

			const mcpEntries: Array<[string, string]> = [];
			const lspEntries: Array<[string, string]> = [];
			const otherExtEntries: Array<[string, string]> = [];

			if (extMap && extMap.size > 0) {
				for (const [key, rawVal] of extMap.entries()) {
					if (!rawVal) continue;
					const lowerKey = key.toLowerCase();
					const lowerVal = rawVal.toLowerCase();

					if (lowerKey.includes("mcp") || lowerVal.includes("mcp:")) {
						mcpEntries.push([key, rawVal]);
					} else if (
						lowerKey.includes("lsp") ||
						lowerKey.includes("lens") ||
						lowerVal.includes("lsp")
					) {
						lspEntries.push([key, rawVal]);
					} else {
						otherExtEntries.push([key, rawVal]);
					}
				}
			}

			// 6. Dedicated MCP Section
			if (config.showMcp) {
				topLines.push(header("MCP", "🔌"));
				if (mcpEntries.length > 0) {
					for (const [, rawVal] of mcpEntries) {
						const cleaned = cleanStatusText(rawVal);
						if (!cleaned) continue;
						const item = cleaned.replace(/^(🔌\s*)?mcp:\s*/i, "🔌 ");
						for (const wrapped of this.wrapText(item, innerWidth)) {
							topLines.push(success(wrapped));
						}
					}
				} else {
					let activeTools: string[] = [];
					try {
						activeTools = this.pi.getActiveTools();
					} catch {
						// Non-fatal
					}
					const mcpTools = activeTools.filter(
						(t) =>
							t.startsWith("mcp_") ||
							t.startsWith("mcp__") ||
							t.startsWith("knowledge_base") ||
							t.startsWith("lotusscript_lsp"),
					);
					if (mcpTools.length > 0) {
						topLines.push(success(`Aktivní (${mcpTools.length} nástrojů)`));
					} else {
						topLines.push(muted("MCP neaktivní"));
					}
				}
				topLines.push("");
			}

			// 7. Dedicated LSP Section (OpenCode style language servers)
			if (config.showLsp) {
				topLines.push(header("LSP", "⚡"));
				let activeTools: string[] = [];
				try {
					activeTools = this.pi.getActiveTools();
				} catch {
					// Non-fatal
				}
				const servers = getWorkspaceLspServers(this.ctx.cwd, activeTools);
				if (servers.length > 0) {
					for (const s of servers) {
						topLines.push(`${success("● ")}${accent(s)} ${dim("ready")}`);
					}
				} else {
					topLines.push(muted("LSP neaktivní"));
				}
				topLines.push("");
			}

			// 8. Remaining Extension Statuses (toggled via /sidebar extensions on|off)
			if (config.showExtensions && otherExtEntries.length > 0) {
				topLines.push(header("ROZŠÍŘENÍ", "🧩"));
				for (const [key, rawVal] of otherExtEntries.sort(([a], [b]) =>
					a.localeCompare(b),
				)) {
					const cleaned = cleanStatusText(rawVal);
					if (!cleaned) continue;

					let fullItem = cleaned;
					const hasIcon =
						/^(\p{Extended_Pictographic}|[•🌿📊📁🛡️🤖⚡🔊🌐📋💰🏷️📦🎯│⇄..])/u.test(
							cleaned,
						);
					if (!hasIcon) {
						let prefix = "• ";
						if (key.includes("translate")) prefix = "🌐 ";
						else if (key.includes("spai")) prefix = "📋 ";
						else if (key.includes("radar") || key.includes("adr")) prefix = "🛡️ ";
						else if (
							key.includes("subagent") ||
							key.includes("council") ||
							key.includes("apple")
						)
							prefix = "🤖 ";
						else if (key.includes("proj")) prefix = "📁 ";
						else if (key.includes("tts") || key.includes("sound")) prefix = "🔊 ";
						fullItem = `${prefix}${cleaned}`;
					}

					for (const wrapped of this.wrapText(fullItem, innerWidth)) {
						topLines.push(muted(wrapped));
					}
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

			// 3. LSP Section (OpenCode classic layout)
			if (config.showLsp) {
				topLines.push(accent("LSP"));

				let activeTools: string[] = [];
				try {
					activeTools = this.pi.getActiveTools();
				} catch {
					// Non-fatal fallback
				}

				const servers = getWorkspaceLspServers(this.ctx.cwd, activeTools);
				if (servers.length > 0) {
					for (const s of servers) {
						topLines.push(muted(s));
					}
				} else {
					topLines.push(muted("LSPs are disabled"));
				}
				topLines.push("");
			}
		}

		// =========================================================================
		// Bottom Section: Git & Workspace (hidden in minimal gauge strip)
		// =========================================================================
		if (config.showGit && config.preset !== "minimal") {
			const cwd = this.ctx.cwd;
			const gitInfo = getGitInfo(cwd);
			const formattedPath = formatProjectPath(cwd, gitInfo.branch);

			if (config.preset === "detailed") {
				bottomLines.push(header("PRACOVNÍ PROSTOR", "📁"));
				const wrappedPath = this.wrapText(`📁 ${formattedPath}`, innerWidth);
				for (const line of wrappedPath) {
					bottomLines.push(th.fg("customMessageLabel", line));
				}

				if (gitInfo.branch) {
					const dirtyIcon = gitInfo.dirty ? "● změny" : "○ čisté";
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
		// Permanent Shortcut Hints Section (hidden in minimal gauge strip)
		// =========================================================================
		if (config.preset !== "minimal") {
			bottomLines.push(header("ZKRATKY", "⌨️"));
			bottomLines.push(dim("⌨️ ctrl+shift+b    « minimal pruh / zpět"));
			bottomLines.push(dim("⌨️ ctrl+shift+←/→  šířka (±4)"));
			bottomLines.push("");

			// =====================================================================
			// Branding Footer
			// =====================================================================
			let brandingText = "• OpenCode 1.18.26";
			if (config.branding === "pi") {
				brandingText = "• Pi Agent v0.84.4";
			} else if (config.branding === "custom" && config.customBrandingText) {
				brandingText = `• ${config.customBrandingText}`;
			}
			bottomLines.push(success(brandingText));
		}

		// =========================================================================
		// Assemble All Content
		// =========================================================================
		const totalLines = topLines.length + bottomLines.length;
		const effectiveRows = this.tui.terminal?.rows || process.stdout?.rows || 24;
		const viewportHeight =
			effectiveRows > 0 ? effectiveRows : Math.max(totalLines, 24);

		let visibleLines: string[];
		if (totalLines <= viewportHeight) {
			const emptyMiddleRows = Math.max(0, viewportHeight - totalLines);
			visibleLines = [
				...topLines,
				...Array.from({ length: emptyMiddleRows }, () => ""),
				...bottomLines,
			];
		} else {
			visibleLines = [...topLines, ...bottomLines];
		}

		return visibleLines.map((content) => {
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
