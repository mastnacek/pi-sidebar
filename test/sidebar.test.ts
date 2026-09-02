import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, getActiveConfig, setActiveConfig } from "../src/config.js";
import { formatProjectPath, getGitInfo } from "../src/git.js";
import { formatCost, formatPercent, formatTokens } from "../src/stats.js";

test("DEFAULT_CONFIG has valid OpenCode defaults", () => {
	assert.equal(DEFAULT_CONFIG.enabled, true);
	assert.equal(DEFAULT_CONFIG.width, 28);
	assert.equal(DEFAULT_CONFIG.preset, "opencode");
	assert.equal(DEFAULT_CONFIG.branding, "opencode");
	assert.equal(DEFAULT_CONFIG.borderStyle, "line");
});

test("formatTokens formats token counts cleanly", () => {
	assert.equal(formatTokens(0), "0 tokens");
	assert.equal(formatTokens(450), "450 tokens");
	assert.equal(formatTokens(1500), "1.5k tokens");
	assert.equal(formatTokens(24500), "25k tokens");
	assert.equal(formatTokens(1200000), "1.2M tokens");
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

test("getActiveConfig and setActiveConfig update active state", () => {
	const custom = { ...DEFAULT_CONFIG, width: 32 };
	setActiveConfig(custom);
	assert.equal(getActiveConfig().width, 32);
	setActiveConfig(DEFAULT_CONFIG);
});
