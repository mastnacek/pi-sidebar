/**
 * Config, stat formatting, statusline wrapping and pane-width maths.
 *
 * Split out of `sidebar.test.ts` (line-limit campaign); the pane frame, tab bar
 * and click-mapping tests live in `sidebar-pane.test.ts`.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_CONFIG,
	getActiveConfig,
	setActiveConfig,
} from "../src/config.js";
import { formatProjectPath, getGitInfo } from "../src/git.js";
import {
	MAX_PANE_WIDTH,
	MIN_PANE_WIDTH,
	clampPaneWidth,
	computeSplitRatio,
} from "../src/pane/herdr.js";
import { contextBar, formatResetTime } from "../src/quota.js";
import {
	formatCostRaw,
	formatCost,
	formatPercent,
	formatTokens,
	formatTokensCompact,
} from "../src/stats.js";
import { formatCwdShort, renderStatusLine, wrapPlain } from "../src/statusline.js";

// ---------------------------------------------------------------------------
// Config (pane-only)
// ---------------------------------------------------------------------------

test("DEFAULT_CONFIG has valid pane-only defaults", () => {
	assert.equal(DEFAULT_CONFIG.enabled, true);
	assert.equal(DEFAULT_CONFIG.tab, "status");
	assert.equal(DEFAULT_CONFIG.paneWidth, 40);
	assert.equal(DEFAULT_CONFIG.paneKeepAlive, false);
	assert.equal(DEFAULT_CONFIG.showSession, true);
	assert.equal(DEFAULT_CONFIG.showGit, true);
});

test("getActiveConfig and setActiveConfig update active state", () => {
	const custom = {
		...DEFAULT_CONFIG,
		paneWidth: 60,
		tab: "skills" as const,
		showGit: false,
	};
	setActiveConfig(custom);
	assert.equal(getActiveConfig().paneWidth, 60);
	assert.equal(getActiveConfig().tab, "skills");
	assert.equal(getActiveConfig().showGit, false);
	setActiveConfig(DEFAULT_CONFIG);
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

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

test("formatCostRaw matches statusline precision", () => {
	assert.equal(formatCostRaw(0), "0.000");
	assert.equal(formatCostRaw(0.0042), "0.0042");
	assert.equal(formatCostRaw(0.05), "0.050");
	assert.equal(formatCostRaw(1.25), "1.25");
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

// ---------------------------------------------------------------------------
// Statusline parity
// ---------------------------------------------------------------------------

const identity = (_token: string, text: string) => text;

test("wrapPlain splits unstyled text by visible width", () => {
	assert.deepEqual(wrapPlain("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	assert.deepEqual(wrapPlain("short", 10), ["short"]);
});

test("renderStatusLine mirrors statusline values without rounding context", () => {
	const lines = renderStatusLine({
		cwd: "D:/proj",
		git: { branch: "main", dirty: true, ahead: 2, behind: 1 },
		color: identity,
		innerWidth: 200,
		sessionName: "sess",
		modelId: "deepseek/test",
		modelProvider: "openrouter",
		modelReasoning: true,
		thinkingLevel: "high",
		contextPercent: 42.53,
		contextWindow: 200000,
		autoCompactEnabled: true,
		cost: 0.05,
		inputTokens: 1500,
		outputTokens: 450,
		cacheRead: 24500,
		cacheWrite: 1000,
		cacheHitRate: 95.2,
		showSession: true,
		showGit: true,
	});
	const all = lines.join("\n");
	assert.ok(all.includes("42.5%/200k"), `context missing: ${all}`);
	assert.ok(all.includes("(auto)"), "auto flag missing");
	assert.ok(all.includes("$0.050"), "cost missing");
	assert.ok(all.includes("⬆️ 1.5k"), "input tokens missing");
	assert.ok(all.includes("⬇️ 450"), "output tokens missing");
	assert.ok(all.includes("🎯95%"), "cache hit rate missing");
	assert.ok(all.includes("🌿 main ●"), "git dirty marker missing");
	assert.ok(all.includes("▸2 ahead"), "ahead marker missing");
	assert.ok(all.includes("◂1 behind"), "behind marker missing");
	assert.ok(all.includes("🏷️ sess"), "session missing");
	assert.ok(all.includes("(openrouter)"), "provider missing");
	assert.ok(all.includes("deepseek/test"), "model missing");
	assert.ok(all.includes("🧠"), "thinking emoji missing");
	assert.ok(all.includes("high"), "thinking level missing");
	assert.ok(!all.includes("…"), "statusline must not truncate");
});

test("renderStatusLine wraps a long model name instead of truncating", () => {
	const modelId = "openrouter/some-extremely-long-model-identifier-1234567890";
	const lines = renderStatusLine({
		cwd: "D:/proj",
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		color: identity,
		innerWidth: 20,
		modelId,
		modelProvider: "openrouter",
		contextPercent: null,
	});
	const all = lines.join("\n");
	assert.ok(!all.includes("…"), "long model must wrap, not truncate");
	// The identifier is split across lines; concatenating chunks recovers it.
	assert.ok(
		all.replace(/\s+/g, "").includes("openrouter/some-extremely"),
		`model text lost: ${all}`,
	);
});

test("formatCwdShort shortens paths under the home directory", () => {
	assert.equal(typeof formatCwdShort(process.cwd()), "string");
});

// ---------------------------------------------------------------------------
// Pane width + split maths
// ---------------------------------------------------------------------------

test("clampPaneWidth keeps width inside the supported range", () => {
	assert.equal(clampPaneWidth(4), MIN_PANE_WIDTH);
	assert.equal(clampPaneWidth(1000), MAX_PANE_WIDTH);
	assert.equal(clampPaneWidth(64), 64);
	assert.ok(MAX_PANE_WIDTH >= 120, "pane should be expandable well past 60");
});

test("computeSplitRatio yields herdr's left-pane fraction for the target width", () => {
	assert.equal(computeSplitRatio(0, 32), 0.5);
	// A 32-column target on a 152-column pane leaves ~79% to the source pane.
	assert.equal(computeSplitRatio(152, 32), 0.789474);
	// Degenerate requests clamp instead of collapsing the split.
	assert.equal(computeSplitRatio(152, 4), 0.894737);
	assert.equal(computeSplitRatio(20, 60), 0.15);
	assert.ok(computeSplitRatio(152, 32) > 0 && computeSplitRatio(152, 32) < 1);
});

// ---------------------------------------------------------------------------
// Tab bar + skills panel
