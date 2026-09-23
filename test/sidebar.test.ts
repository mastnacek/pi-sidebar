import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_CONFIG,
	getActiveConfig,
	setActiveConfig,
} from "../src/config.js";
import { formatProjectPath, getGitInfo } from "../src/git.js";
import { mapClickToTab, parseClickRequest } from "../src/pane/click.js";
import {
	MAX_PANE_WIDTH,
	MIN_PANE_WIDTH,
	clampPaneWidth,
	computeSplitRatio,
} from "../src/pane/herdr.js";
import { buildPaneFrame, buildPaneLines } from "../src/pane/lines.js";
import {
	consumeClickRequest,
	readPaneSnapshot,
	resolveRequestPath,
	resolveSnapshotPath,
	writePaneSnapshot,
} from "../src/pane/snapshot.js";
import { contextBar, formatResetTime } from "../src/quota.js";
import {
	type SkillStatePublisher,
	SkillBridge,
	renderSkillsPanel,
} from "../src/skills-tab.js";
import {
	formatCostRaw,
	formatCost,
	formatPercent,
	formatTokens,
	formatTokensCompact,
} from "../src/stats.js";
import { formatCwdShort, renderStatusLine, wrapPlain } from "../src/statusline.js";
import {
	isSidebarTab,
	nextTab,
	renderTabBar,
	type TabHitRange,
} from "../src/tabs.js";

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
// ---------------------------------------------------------------------------

const tabBarStyle = {
	accent: (s: string) => `<a>${s}</a>`,
	muted: (s: string) => `<m>${s}</m>`,
	dim: (s: string) => `<d>${s}</d>`,
	bold: (s: string) => `<b>${s}</b>`,
};

const plainTabBarStyle = {
	accent: (s: string) => s,
	muted: (s: string) => s,
	dim: (s: string) => s,
	bold: (s: string) => s,
};

const panelStyle = {
	accent: (s: string) => s,
	muted: (s: string) => s,
	dim: (s: string) => s,
	success: (s: string) => s,
	warning: (s: string) => s,
	error: (s: string) => s,
};

const naiveWrap = (text: string, maxWidth: number): string[] => {
	if (maxWidth <= 0 || text.length <= maxWidth) return [text];
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += maxWidth) {
		chunks.push(text.slice(i, i + maxWidth));
	}
	return chunks;
};

function makeSkillPublisher(): {
	publisher: SkillStatePublisher;
	publish: (payload: unknown) => void;
} {
	let handler: ((data: unknown) => void) | null = null;
	const publisher: SkillStatePublisher = {
		events: {
			on: (_channel: string, h: (data: unknown) => void) => {
				handler = h;
				return () => {
					handler = null;
				};
			},
		},
	};
	return {
		publisher,
		publish: (payload: unknown) => handler?.(payload),
	};
}

test("renderTabBar marks the active tab and exposes clickable ranges", () => {
	const bar = renderTabBar("status", 40, tabBarStyle);
	assert.deepEqual(
		bar.hits.map((hit) => hit.id),
		["status", "skills"],
	);
	assert.ok(bar.line.includes("<b><a>Status</a></b>"));
	assert.ok(bar.line.includes("<m>Skills</m>"));
	assert.ok(bar.hits[0].start < bar.hits[0].end);
	assert.ok(bar.hits[0].end < bar.hits[1].start);
});

test("renderTabBar falls back to numbered tabs when narrow", () => {
	const bar = renderTabBar("skills", 8, plainTabBarStyle);
	assert.ok(!bar.line.includes("Status"));
	assert.ok(bar.line.includes("1"));
	assert.ok(bar.line.includes("2"));
	for (const hit of bar.hits) {
		assert.ok(hit.end <= 8, `range exceeds width: ${JSON.stringify(hit)}`);
	}
});

test("nextTab cycles with wrap-around", () => {
	assert.equal(nextTab("status", 1), "skills");
	assert.equal(nextTab("skills", 1), "status");
	assert.equal(nextTab("status", -1), "skills");
});

test("isSidebarTab rejects unknown names", () => {
	assert.equal(isSidebarTab("status"), true);
	assert.equal(isSidebarTab("skills"), true);
	assert.equal(isSidebarTab("nope"), false);
});

test("renderSkillsPanel asks for the publisher when nothing arrived", () => {
	const bridge = new SkillBridge();
	const lines = renderSkillsPanel(bridge, 40, panelStyle, naiveWrap);
	assert.ok(lines.join("\n").includes("Waiting for pi-plugin-dev"));
});

test("renderSkillsPanel renders skill, references and compliance gates", () => {
	const { publisher, publish } = makeSkillPublisher();
	const bridge = new SkillBridge();
	bridge.attach(publisher);

	publish({
		live: true,
		activeSkill: "pi-plugin-dev",
		references: [{ name: "command-completions.md", summary: "Trailing Space" }],
		actions: [{ type: "read", target: "tracker.ts", summary: "Inspecting", timestamp: 1 }],
		compliance: [
			{ rule: "peer-deps", label: "PeerDeps Guard", status: "pass", details: "ok" },
			{ rule: "string-enum", label: "StringEnum Rule", status: "fail", details: "bad" },
		],
		inspectedCount: 5,
		modifiedCount: 1,
		startTime: Date.now() - 12_000,
		lastUpdateTime: Date.now(),
		inTurn: false,
		turnCount: 3,
	});

	const joined = renderSkillsPanel(bridge, 40, panelStyle, naiveWrap).join("\n");
	assert.ok(joined.includes("pi-plugin-dev"));
	assert.ok(joined.includes("command-completions.md"));
	assert.ok(joined.includes("tracker.ts"));
	assert.ok(joined.includes("[PASS]"));
	assert.ok(joined.includes("[FAIL]"));
	assert.ok(joined.includes("Gates 1/2"));
	assert.ok(joined.includes("settled"));
});

test("live:false clears state but records that a publisher exists", () => {
	const { publisher, publish } = makeSkillPublisher();
	const bridge = new SkillBridge();
	bridge.attach(publisher);

	publish({ live: true, activeSkill: "x" });
	assert.ok(bridge.getState());

	publish({ live: false });
	assert.equal(bridge.getState(), null);
	assert.equal(bridge.hasPublisher(), true);
});

// ---------------------------------------------------------------------------
// Pane frame
// ---------------------------------------------------------------------------

function paneInput(overrides: Record<string, unknown> = {}) {
	return {
		width: 40,
		bridge: new SkillBridge(),
		color: identity,
		cwd: process.cwd(),
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		contextPercent: null,
		...overrides,
	} as Parameters<typeof buildPaneLines>[0];
}

test("buildPaneLines renders the plugin-dev HUD plus the statusline mirror", () => {
	const lines = buildPaneLines(
		paneInput({
			width: 60,
			face: "skills",
			modelId: "deepseek/test-model",
			modelProvider: "test-provider",
			thinkingLevel: "high",
			contextPercent: 42,
			git: { branch: "main", dirty: false, ahead: 0, behind: 0 },
		}),
	);
	const all = lines.join("\n");

	assert.ok(all.includes("Waiting for pi-plugin-dev"));
	assert.ok(all.includes("deepseek"));
	// Context is shown unrounded, like the statusline.
	assert.ok(all.includes("42.0%"));
	assert.ok(all.includes("🌿 main"));
	assert.ok(all.includes("○"), "clean git marker missing");
	assert.ok(all.includes("📊"), "context segment missing");
	assert.ok(all.includes("💰"), "cost segment missing");

	// Shortcut hints were removed; overlay-only telemetry must not leak in.
	assert.ok(!all.includes("ZKRATKY"));
	assert.ok(!all.includes("MODEL"));
	assert.ok(!all.includes("TOKENY"));
	assert.ok(!all.includes("MCP"));
	assert.ok(!all.includes("LSP"));

	// Every line is padded to the exact pane width.
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 60, `line wider than pane: ${line}`);
	}
});

test("buildPaneLines wraps instead of painting ellipsis", () => {
	const lines = buildPaneLines(
		paneInput({
			width: 24,
			face: "status",
			modelId: "provider/very-long-model-identifier",
			modelProvider: "provider",
			contextPercent: 12,
		}),
	);
	const all = lines.join("\n");
	assert.ok(!all.includes("…"), `pane must not truncate: ${all}`);
	assert.ok(!all.includes("..."), `pane must not truncate: ${all}`);
	assert.ok(all.includes("12.0%"), "context missing");
});

test("pane frame renders the Status | Skills tab strip with click ranges", () => {
	const frame = buildPaneFrame(
		paneInput({ width: 40, face: "skills", activeTab: "skills" }),
	);
	assert.ok(frame.lines[0].includes("Status"));
	assert.ok(frame.lines[0].includes("Skills"));
	assert.ok(frame.lines[1].includes("─"));
	assert.equal(frame.tabHits.length, 2);
	assert.equal(frame.tabHits[0].id, "status");
	assert.equal(frame.tabHits[1].id, "skills");
	assert.ok(frame.tabHits[0].start < frame.tabHits[1].start);
	for (const hit of frame.tabHits) {
		assert.ok(hit.start >= 0 && hit.end <= 40, `bad range ${JSON.stringify(hit)}`);
	}
});

test("pane frame keeps face and active tab consistent", () => {
	const frame = buildPaneFrame(
		paneInput({ width: 40, face: "status", activeTab: "status", sessionTitle: "sess-x" }),
	);
	const all = frame.lines.join("\n");
	assert.ok(all.includes("sess-x"));
	assert.ok(!all.includes("Waiting for pi-plugin-dev"));
	assert.equal(frame.tabHits.length, 2);
});

// ---------------------------------------------------------------------------
// Pane snapshot + clicks
// ---------------------------------------------------------------------------

test("pane snapshot round-trips through its wire format", () => {
	const path = join(tmpdir(), `pi-sidebar-pane-test-${process.pid}.json`);
	const snapshot = {
		version: 1,
		live: true,
		key: "w1M:p1",
		revision: 7,
		width: 32,
		generatedAt: new Date().toISOString(),
		lines: ["│ one", "│ two"],
	};

	assert.equal(writePaneSnapshot(path, snapshot), true);
	const read = readPaneSnapshot(path);
	assert.equal(read?.revision, 7);
	assert.equal(read?.live, true);
	assert.deepEqual(read?.lines, ["│ one", "│ two"]);

	rmSync(path, { force: true });
	assert.equal(readPaneSnapshot(path), null);
});

test("resolveSnapshotPath keys the snapshot by pane id", () => {
	assert.ok(resolveSnapshotPath("w1M:p1").endsWith(join("pi-sidebar", "w1M_p1.json")));
	assert.ok(resolveSnapshotPath(null).endsWith("unbound.json"));
});

const CLICK_HITS: TabHitRange[] = [
	{ id: "status", start: 0, end: 6 },
	{ id: "skills", start: 9, end: 15 },
];

test("click mapping resolves columns against the tab hit ranges", () => {
	const at = Date.now();
	assert.equal(mapClickToTab({ at, column: 3, row: 1 }, CLICK_HITS), "status");
	assert.equal(mapClickToTab({ at, column: 12, row: 1 }, CLICK_HITS), "skills");
	assert.equal(mapClickToTab({ at, column: 10, row: 1 }, CLICK_HITS), null);
	assert.equal(mapClickToTab({ at, column: 1, row: 1 }, CLICK_HITS), null);
	assert.equal(mapClickToTab({ at, column: 12, row: 2 }, CLICK_HITS), null);
});

test("click requests are validated and expire", () => {
	const now = Date.now();
	assert.deepEqual(parseClickRequest({ at: now, column: 12, row: 1 }, now), {
		at: now,
		column: 12,
		row: 1,
	});
	assert.equal(parseClickRequest({ at: now - 10_000, column: 12, row: 1 }, now), null);
	assert.equal(parseClickRequest({ at: now + 60_000, column: 12, row: 1 }, now), null);
	assert.equal(parseClickRequest({ column: 12, row: 1 }, now), null);
	assert.equal(parseClickRequest({ at: now, column: 0, row: 1 }, now), null);
	assert.equal(parseClickRequest("nope", now), null);
	assert.equal(parseClickRequest(null, now), null);
});

test("click request files are consumed exactly once", () => {
	const path = resolveRequestPath(
		join(tmpdir(), `pi-sidebar-request-test-${process.pid}.json`),
	);
	writeFileSync(path, JSON.stringify({ at: Date.now(), column: 12, row: 1 }), "utf8");

	const first = consumeClickRequest(path);
	assert.equal(first?.column, 12);
	assert.equal(consumeClickRequest(path), null);

	rmSync(path, { force: true });
});
