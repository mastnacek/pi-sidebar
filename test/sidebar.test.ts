import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_CONFIG,
	getActiveConfig,
	setActiveConfig,
} from "../src/config.js";
import { formatProjectPath, getGitInfo } from "../src/git.js";
import { contextBar, formatResetTime } from "../src/quota.js";
import { SidebarComponent } from "../src/sidebar-component.js";
import { isBrailleRow, ringGauge } from "../src/gauge.js";
import {
	formatCost,
	formatPercent,
	formatTokens,
	formatTokensCompact,
} from "../src/stats.js";

test("DEFAULT_CONFIG has valid OpenCode defaults", () => {
	assert.equal(DEFAULT_CONFIG.enabled, true);
	assert.equal(DEFAULT_CONFIG.width, 28);
	assert.equal(DEFAULT_CONFIG.preset, "opencode");
	assert.equal(DEFAULT_CONFIG.branding, "pi");
	assert.equal(DEFAULT_CONFIG.borderStyle, "line");
	assert.equal(DEFAULT_CONFIG.showModel, true);
	assert.equal(DEFAULT_CONFIG.showQuota, true);
	assert.equal(DEFAULT_CONFIG.showCache, true);
	assert.equal(DEFAULT_CONFIG.showMcp, true);
	assert.equal(DEFAULT_CONFIG.showLsp, true);
	assert.equal(DEFAULT_CONFIG.showExtensions, true);
	assert.equal(DEFAULT_CONFIG.showGit, true);
});

test("formatTokens formats token counts cleanly", () => {
	assert.equal(formatTokens(0), "0 tokens");
	assert.equal(formatTokens(450), "450 tokens");
	assert.equal(formatTokens(1500), "1.5k tokens");
	assert.equal(formatTokens(24500), "25k tokens");
	assert.equal(formatTokens(1200000), "1.2M tokens");
});

test("formatTokensCompact formats token counts compactly", () => {
	assert.equal(formatTokensCompact(0), "0");
	assert.equal(formatTokensCompact(450), "450");
	assert.equal(formatTokensCompact(1500), "1.5k");
	assert.equal(formatTokensCompact(24500), "25k");
	assert.equal(formatTokensCompact(1200000), "1.2M");
});

test("formatCost formats dollar amounts cleanly", () => {
	assert.equal(formatCost(0), "$0.00 spent");
	assert.equal(formatCost(0.0042), "$0.0042 spent");
	assert.equal(formatCost(0.05), "$0.050 spent");
	assert.equal(formatCost(1.25), "$1.25 spent");
});

test("formatPercent formats usage percentage cleanly", () => {
	assert.equal(formatPercent(null), "0% used");
	assert.equal(formatPercent(0), "0% used");
	assert.equal(formatPercent(0.4), "0.4% used");
	assert.equal(formatPercent(12.8), "13% used");
	assert.equal(formatPercent(100), "100% used");
});

test("contextBar generates progress bars matching width", () => {
	assert.equal(contextBar(null, 8), "░░░░░░░░");
	assert.equal(contextBar(0, 8), "░░░░░░░░");
	assert.equal(contextBar(50, 8), "████░░░░");
	assert.equal(contextBar(100, 8), "████████");
});

test("formatResetTime handles ISO strings gracefully", () => {
	assert.equal(formatResetTime(undefined), "?");
	assert.equal(formatResetTime("invalid"), "?");
	const valid = formatResetTime("2026-08-30T15:30:00Z");
	assert.match(valid, /\d+\.\d+\.\s+\d+:\d+/);
});

test("formatProjectPath formats project paths with branch", () => {
	const formatted = formatProjectPath("D:/01_programovani/pi/plugins", "main");
	assert.match(formatted, /:main$/);
});

test("getGitInfo returns branch information in git directory", () => {
	const info = getGitInfo(process.cwd());
	assert.equal(typeof info.dirty, "boolean");
	assert.equal(typeof info.ahead, "number");
	assert.equal(typeof info.behind, "number");
});

test("SidebarComponent renders lines cleanly", () => {
	const mockTui: any = { terminal: { rows: 24, columns: 80 } };
	const mockPi: any = {
		getActiveTools: () => [],
		getThinkingLevel: () => "off",
	};
	const mockCtx: any = {
		cwd: process.cwd(),
		model: { id: "test-model" },
		sessionManager: { getSessionName: () => "test", getEntries: () => [] },
		getContextUsage: () => null,
	};
	const mockTheme: any = {
		fg: (_: string, s: string) => s,
		bg: (_: string, s: string) => s,
	};

	const sidebar = new SidebarComponent(mockTui, mockPi, mockCtx, mockTheme);
	const rendered = sidebar.render(28);
	assert.equal(Array.isArray(rendered), true);
	assert.ok(rendered.length > 0);
});

test("getActiveConfig and setActiveConfig update active state", () => {
	const custom = {
		...DEFAULT_CONFIG,
		width: 32,
		preset: "detailed" as const,
		showExtensions: true,
	};
	setActiveConfig(custom);
	assert.equal(getActiveConfig().width, 32);
	assert.equal(getActiveConfig().preset, "detailed");
	assert.equal(getActiveConfig().showExtensions, true);
	setActiveConfig(DEFAULT_CONFIG);
});

test("ringGauge renders braille rows of correct dimensions", () => {
	const rows = ringGauge(50, 5, 3);
	assert.equal(rows.length, 3);
	for (const row of rows) {
		assert.equal(row.length, 5);
		assert.ok(isBrailleRow(row), `not braille: ${row}`);
	}
});

test("ringGauge fills proportionally to percent", () => {
	const filledCount = (s: string) =>
		[...s].filter((ch) => ch.codePointAt(0)! > 0x2800).length;
	const empty = ringGauge(0, 5, 3).join("");
	const full = ringGauge(100, 5, 3).join("");
	assert.ok(filledCount(empty) === 0, "0% ring should be empty");
	assert.ok(filledCount(full) > 10, "100% ring should fill the outline");
	const half = ringGauge(50, 5, 3).join("");
	assert.ok(
		filledCount(half) > 0 && filledCount(half) < filledCount(full),
		"50% ring should be partially filled",
	);
});

test("SidebarComponent minimal preset renders gauge strip", () => {
	const mockTui: any = { terminal: { rows: 24, columns: 80 } };
	const mockPi: any = {
		getActiveTools: () => [],
		getThinkingLevel: () => "high",
	};
	const mockCtx: any = {
		cwd: process.cwd(),
		model: { id: "test-model", reasoning: true },
		sessionManager: { getSessionName: () => "test", getEntries: () => [] },
		getContextUsage: () => ({
			percent: 42,
			tokens: 84000,
			contextWindow: 200000,
		}),
	};
	const mockTheme: any = {
		fg: (_: string, s: string) => s,
		bg: (_: string, s: string) => s,
	};

	setActiveConfig({ ...DEFAULT_CONFIG, preset: "minimal", width: 10 });
	const sidebar = new SidebarComponent(mockTui, mockPi, mockCtx, mockTheme);
	const rendered = sidebar.render(10);
	assert.ok(rendered.length > 0);

	const all = rendered.join("\n");
	// Ring gauge present (braille characters)
	assert.ok(
		[...all].some((ch) => ch.codePointAt(0)! >= 0x2800),
		"expected braille ring characters",
	);
	// Percent shown
	assert.ok(all.includes("42%"));
	// Thinking emoji for 'high'
	assert.ok(all.includes("🧠"));
	// No shortcut hints or branding in minimal mode
	assert.ok(!all.includes("ZKRATKY"));
	assert.ok(!all.includes("OpenCode 1.18.26"));
	setActiveConfig(DEFAULT_CONFIG);
});
