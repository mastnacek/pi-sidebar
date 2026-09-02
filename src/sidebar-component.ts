import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { getActiveConfig } from "./config.js";
import { formatProjectPath, getGitInfo } from "./git.js";
import { formatCost, formatPercent, formatTokens, getSessionStats } from "./stats.js";

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

			// Try to break at path separators, punctuation, or spaces
			let sliceLen = maxWidth;
			let foundBreak = false;

			// Look backwards from maxWidth for good break points: \, /, :, -, _, space
			for (let i = Math.min(current.length, maxWidth); i > Math.max(1, maxWidth - 10); i--) {
				const char = current[i - 1];
				if (char === "\\" || char === "/" || char === ":" || char === " " || char === "-") {
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
		const success = (s: string) => th.fg("success", s);

		const topLines: string[] = [];
		const bottomLines: string[] = [];

		// ================= 1. Top Section: Session =================
		if (config.showSession) {
			const sessionName = this.ctx.sessionManager.getSessionName();
			const sessionTitle = sessionName ? `Session - ${sessionName}` : `New session - ${this.sessionStartIso}`;
			const wrappedSession = this.wrapText(sessionTitle, innerWidth);
			for (const line of wrappedSession) {
				topLines.push(muted(line));
			}
			topLines.push("");
		}

		// ================= 2. Context Section =================
		if (config.showContext) {
			const stats = getSessionStats(this.ctx);
			topLines.push(accent("Context"));

			const tokensStr = formatTokens(stats.contextTokens ?? stats.totalInputTokens + stats.totalOutputTokens);
			topLines.push(muted(tokensStr));

			const percentStr = formatPercent(stats.contextPercent);
			topLines.push(muted(percentStr));

			const costStr = formatCost(stats.totalCost);
			topLines.push(muted(costStr));

			topLines.push("");
		}

		// ================= 3. LSP Section =================
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
				return lower.includes("lsp") || lower.includes("lens") || lower.includes("ast_grep");
			});

			if (lspTools.length > 0) {
				topLines.push(muted(`Active (${lspTools.length} tools)`));
			} else {
				topLines.push(muted("LSPs are disabled"));
			}
			topLines.push("");
		}

		// ================= 4. Bottom Section: Git & Path =================
		if (config.showGit) {
			const cwd = this.ctx.cwd;
			const gitInfo = getGitInfo(cwd);
			const formattedPath = formatProjectPath(cwd, gitInfo.branch);
			const wrappedPath = this.wrapText(formattedPath, innerWidth);

			for (const line of wrappedPath) {
				bottomLines.push(th.fg("customMessageLabel", line));
			}
			bottomLines.push("");
		}

		// ================= 5. Branding Footer =================
		let brandingText = "• OpenCode 1.18.26";
		if (config.branding === "pi") {
			brandingText = "• Pi Agent v0.84.4";
		} else if (config.branding === "custom" && config.customBrandingText) {
			brandingText = `• ${config.customBrandingText}`;
		}
		bottomLines.push(success(brandingText));

		// ================= Assemble Vertical Layout =================
		const totalContentRows = topLines.length + bottomLines.length;
		const targetHeight = Math.max(totalContentRows, termHeight);
		const emptyMiddleRows = Math.max(1, targetHeight - totalContentRows);

		const allContentLines: string[] = [
			...topLines,
			...Array.from({ length: emptyMiddleRows }, () => ""),
			...bottomLines,
		];

		// Format every line with border and pad to exact width
		return allContentLines.map((content) => {
			const border = config.borderStyle === "none" ? "" : th.fg("border", borderPrefix);
			const lineWithoutBorder = content;
			const lineVisWidth = visibleWidth(lineWithoutBorder);
			const padLen = Math.max(0, innerWidth - lineVisWidth);
			const paddedContent = lineWithoutBorder + " ".repeat(padLen);
			const fullLine = border + paddedContent;

			// Ensure line does not exceed requested width
			return visibleWidth(fullLine) > width ? sliceByColumn(fullLine, 0, width, true) : fullLine;
		});
	}
}
