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
import { clampPaneWidth, computeSplitRatio } from "../src/pane/herdr.js";
import { mapClickToTab, parseClickRequest } from "../src/pane/click.js";
import { buildPaneFrame, buildPaneLines } from "../src/pane/lines.js";
import {
	consumeClickRequest,
	readPaneSnapshot,
	resolveRequestPath,
	resolveSnapshotPath,
	writePaneSnapshot,
} from "../src/pane/snapshot.js";
import { contextBar, formatResetTime } from "../src/quota.js";
import { SidebarComponent } from "../src/sidebar-component.js";
import { isBrailleRow, ringGauge } from "../src/gauge.js";
import {
	type SkillStatePublisher,
	SkillBridge,
	renderSkillsPanel,
} from "../src/skills-tab.js";
import { isSidebarTab, nextTab, renderTabBar, type TabHitRange } from "../src/tabs.js";
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
	assert.equal(DEFAULT_CONFIG.paneMode, "herdr");
	assert.equal(DEFAULT_CONFIG.paneWidth, 32);
	assert.equal(DEFAULT_CONFIG.paneKeepAlive, false);
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
	assert.ok(all.includes("T:high"));
	// No shortcut hints or branding in minimal mode
	assert.ok(!all.includes("ZKRATKY"));
	assert.ok(!all.includes("OpenCode 1.18.26"));
	setActiveConfig(DEFAULT_CONFIG);
});

test("SidebarComponent minimal LSP uses real status and spinner when busy", () => {
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

	setActiveConfig({ ...DEFAULT_CONFIG, preset: "minimal", width: 10 });
	const sidebar = new SidebarComponent(mockTui, mockPi, mockCtx, mockTheme);
	sidebar.updateFooterData({
		getExtensionStatuses: () =>
			new Map([["pi-lens-lsp", "LSP Active: typescript"]]),
	} as any);

	// Idle: real status wins over heuristic — shows abbreviated server + dot
	const idle = sidebar.render(10).join("\n");
	assert.ok(idle.includes("LSP"), "LSP label missing");
	assert.ok(idle.includes("TS"), "server abbreviation missing");
	assert.ok(idle.includes("●"), "ready dot missing");

	// Busy: spinner frame replaces the dot
	sidebar.updateBusy(true);
	const busy = sidebar.render(10).join("\n");
	assert.ok(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(busy), "expected spinner frame while busy");
	sidebar.updateBusy(false);
	setActiveConfig(DEFAULT_CONFIG);
});

// ---------------------------------------------------------------------------
// Tab bar
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

/** Fake the shared event bus and expose the captured handler. */
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
	// Active tab is bold + accent, the inactive one is muted.
	assert.ok(bar.line.includes("<b><a>Status</a></b>"));
	assert.ok(bar.line.includes("<m>Skills</m>"));
	// Ranges are ordered, non-overlapping, and measured on plain label text.
	assert.ok(bar.hits[0].start < bar.hits[0].end);
	assert.ok(bar.hits[0].end < bar.hits[1].start);
});

test("renderTabBar falls back to numbered tabs when narrow", () => {
	const bar = renderTabBar("skills", 8, plainTabBarStyle);
	assert.ok(!bar.line.includes("Status"), "full labels should not fit in 8 cols");
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

// ---------------------------------------------------------------------------
// Skills tab (pi-plugin-dev event-bus bridge)
// ---------------------------------------------------------------------------

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
		actions: [
			{ type: "read", target: "tracker.ts", summary: "Inspecting", timestamp: 1 },
		],
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
	assert.ok(joined.includes("[PASS]"), "passing gate badge missing");
	assert.ok(joined.includes("[FAIL]"), "failing gate badge missing");
	assert.ok(joined.includes("Gates 1/2"), "scorecard missing");
	assert.ok(joined.includes("settled"), "settled footer missing");
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
// Tab bar integration in SidebarComponent
// ---------------------------------------------------------------------------

function mockSidebarDeps() {
	const state = { renders: 0, appended: [] as unknown[] };
	const tui: any = {
		terminal: { rows: 24, columns: 80 },
		requestRender: () => {
			state.renders += 1;
		},
	};
	const pi: any = {
		getActiveTools: () => [],
		getThinkingLevel: () => "off",
		appendEntry: (_type: string, data: unknown) => {
			state.appended.push(data);
		},
	};
	const ctx: any = {
		cwd: process.cwd(),
		model: { id: "test-model" },
		sessionManager: { getSessionName: () => "test", getEntries: () => [] },
		getContextUsage: () => null,
	};
	const theme: any = {
		fg: (_: string, s: string) => s,
		bg: (_: string, s: string) => s,
		bold: (s: string) => s,
	};
	return { tui, pi, ctx, theme, state };
}

test("SidebarComponent renders the tab bar as the first row", () => {
	const { tui, pi, ctx, theme } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "status", width: 28 });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);
	const rendered = sidebar.render(28);
	assert.ok(rendered[0].includes("Status"), "tab bar should be row 0");
	assert.ok(rendered[0].includes("Skills"));
	setActiveConfig(DEFAULT_CONFIG);
});

test("clicking the Skills tab switches the panel and persists it", () => {
	const { tui, pi, ctx, theme, state } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "status", width: 28 });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);

	const firstRow = sidebar.render(28)[0];
	const skillsX = firstRow.indexOf("Skills");
	assert.ok(skillsX > 0, "Skills label not found in the tab bar");

	const result = sidebar.handleMouse({
		type: "click",
		button: "left",
		x: skillsX,
		y: 0,
	});

	assert.equal(result?.handled, true);
	assert.equal(getActiveConfig().tab, "skills");
	assert.ok(state.appended.length > 0, "tab change should be persisted");
	assert.ok(state.renders > 0, "tab change should request a render");
	assert.ok(
		sidebar.render(28).join("\n").includes("Waiting for pi-plugin-dev"),
		"skills body should render after the switch",
	);
	setActiveConfig(DEFAULT_CONFIG);
});

test("Skills tab shows only HUD, Model, Context, Git and Shortcuts", () => {
	const { tui, pi, ctx, theme } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "skills", width: 28 });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);
	const rows = sidebar.render(28);
	const all = rows.join("\n");

	// Required sections, in order.
	const order = [
		"Waiting for pi-plugin-dev",
		"MODEL",
		"test-model",
		"CONTEXT",
		"GIT",
		"ZKRATKY",
	];
	let cursor = 0;
	for (const needle of order) {
		const idx = all.indexOf(needle, cursor);
		assert.ok(idx >= 0, `missing or out of order: ${needle}`);
		cursor = idx + needle.length;
	}

	// Nothing else: no session, quota, tokens/cache, MCP, LSP, extensions, branding.
	assert.ok(!all.includes("Session"), "session line must not render");
	assert.ok(!all.includes("KVÓTY"), "quota must not render");
	assert.ok(!all.includes("TOKENY"), "tokens/cache must not render");
	assert.ok(!all.includes("MCP"), "MCP must not render");
	assert.ok(!all.includes("LSP"), "LSP must not render");
	assert.ok(!all.includes("ROZŠÍŘENÍ"), "extensions must not render");
	assert.ok(!all.includes("Pi Agent v0.84.4"), "branding must not render");
	setActiveConfig(DEFAULT_CONFIG);
});

test("handleMouse ignores clicks outside the tab-bar row", () => {
	const { tui, pi, ctx, theme } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "status", width: 28 });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);
	sidebar.render(28);

	assert.equal(
		sidebar.handleMouse({ type: "click", button: "left", x: 3, y: 5 }),
		undefined,
	);
	assert.equal(getActiveConfig().tab, "status");
	setActiveConfig(DEFAULT_CONFIG);
});

test("handleMouse ignores non-click and non-left-button events", () => {
	const { tui, pi, ctx, theme } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "status", width: 28 });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);
	sidebar.render(28);

	assert.equal(
		sidebar.handleMouse({ type: "move", button: "left", x: 10, y: 0 }),
		undefined,
	);
	assert.equal(
		sidebar.handleMouse({ type: "click", button: "right", x: 10, y: 0 }),
		undefined,
	);
	assert.equal(getActiveConfig().tab, "status");
	setActiveConfig(DEFAULT_CONFIG);
});

test("tabs can be disabled via showTabBar", () => {
	const { tui, pi, ctx, theme } = mockSidebarDeps();
	setActiveConfig({ ...DEFAULT_CONFIG, tab: "status", showTabBar: false });
	const sidebar = new SidebarComponent(tui, pi, ctx, theme);
	sidebar.render(28);
	assert.equal(
		sidebar.handleMouse({ type: "click", button: "left", x: 3, y: 0 }),
		undefined,
	);
	setActiveConfig(DEFAULT_CONFIG);
});

// ---------------------------------------------------------------------------
// herdr pane mode (snapshot bridge + standalone renderer)
// ---------------------------------------------------------------------------

test("pane width is clamped to a readable range", () => {
	assert.equal(clampPaneWidth(32), 32);
	assert.equal(clampPaneWidth(4), 16);
	assert.equal(clampPaneWidth(500), 60);
	assert.equal(clampPaneWidth(Number.NaN), 32);
});

test("computeSplitRatio yields herdr's left-pane fraction for the target width", () => {
	// Matches the measured default sidebar: 32 columns of a 152-column tab.
	assert.equal(computeSplitRatio(152, 32), 0.789474);
	// Degenerate requests clamp instead of collapsing the split.
	assert.equal(computeSplitRatio(152, 4), 0.894737);
	assert.equal(computeSplitRatio(20, 60), 0.15);
	assert.ok(computeSplitRatio(152, 32) > 0 && computeSplitRatio(152, 32) < 1);
});

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

test("buildPaneLines renders HUD, model, context, git and shortcuts only", () => {
	const bridge = new SkillBridge();
	const lines = buildPaneLines({
		width: 32,
		bridge,
		face: "skills",
		modelId: "deepseek/test-model",
		modelProvider: "test-provider",
		thinkingLevel: "high",
		contextPercent: 42,
		git: { branch: "main", dirty: false, ahead: 0, behind: 0 },
		cwd: process.cwd(),
		color: (_token: string, text: string) => text,
	});
	const all = lines.join("\n");

	assert.ok(all.includes("Waiting for pi-plugin-dev"));
	assert.ok(all.includes("MODEL"));
	assert.ok(all.includes("deepseek/test-model"));
	assert.ok(all.includes("CONTEXT"));
	assert.ok(all.includes("42%"));
	assert.ok(all.includes("GIT"));
	assert.ok(all.includes("ZKRATKY"));

	// Excluded telemetry must never leak into the pane face.
	assert.ok(!all.includes("TOKENY"));
	assert.ok(!all.includes("MCP"));
	assert.ok(!all.includes("LSP"));
	assert.ok(!all.includes("ROZŠÍŘENÍ"));
	assert.ok(!all.includes("Pi Agent v0.84.4"));

	// Every line is padded to the exact pane width, so the renderer paints blindly.
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 32, `line wider than pane: ${line}`);
	}
	assert.ok(lines.some((line) => line.endsWith(" ")), "lines should be padded");
});

test("pane frame renders the Status | Skills tab strip with click ranges", () => {
	const bridge = new SkillBridge();
	const frame = buildPaneFrame({
		width: 30,
		bridge,
		face: "skills",
		activeTab: "skills",
		modelId: "m",
		thinkingLevel: "off",
		contextPercent: 12,
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		cwd: process.cwd(),
		color: (_token: string, text: string) => text,
	});
	const all = frame.lines.join("\n");

	// Strip is row 0, separator row 1, content below.
	assert.ok(frame.lines[0].includes("Status"));
	assert.ok(frame.lines[0].includes("Skills"));
	assert.ok(frame.lines[1].includes("─"));
	assert.equal(frame.tabHits.length, 2);
	assert.equal(frame.tabHits[0].id, "status");
	assert.equal(frame.tabHits[1].id, "skills");
	assert.ok(
		frame.tabHits[0].start < frame.tabHits[1].start,
		"status must sit before skills",
	);

	// Ranges are relative to the content area and stay inside the padded line.
	for (const hit of frame.tabHits) {
		assert.ok(hit.start >= 0 && hit.end <= 30, `bad range ${JSON.stringify(hit)}`);
	}

	assert.ok(all.includes("MODEL"));
	assert.ok(all.includes("CONTEXT"));
	assert.ok(all.includes("Waiting for pi-plugin-dev"));
});

test("pane frame keeps face and active tab consistent", () => {
	const bridge = new SkillBridge();
	const frame = buildPaneFrame({
		width: 30,
		bridge,
		face: "status",
		activeTab: "status",
		sessionTitle: "sess-x",
		modelId: "m",
		thinkingLevel: "off",
		contextPercent: null,
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		cwd: process.cwd(),
		color: (_token: string, text: string) => text,
	});
	const all = frame.lines.join("\n");
	assert.ok(all.includes("sess-x"));
	assert.ok(!all.includes("Waiting for pi-plugin-dev"));
	assert.equal(frame.tabHits.length, 2);
});

test("legacy buildPaneLines still returns the painted lines", () => {
	const bridge = new SkillBridge();
	const lines = buildPaneLines({
		width: 30,
		bridge,
		modelId: "m",
		thinkingLevel: "off",
		contextPercent: 5,
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		cwd: process.cwd(),
		color: (_token: string, text: string) => text,
	});
	assert.ok(Array.isArray(lines));
	assert.ok(lines.length > 0);
	assert.ok(lines.join("\n").includes("MODEL"));
});

// ---------------------------------------------------------------------------
// Pane tab clicks (the "bookmark clicker")
// ---------------------------------------------------------------------------

const CLICK_HITS: TabHitRange[] = [
	{ id: "status", start: 0, end: 6 },
	{ id: "skills", start: 9, end: 15 },
];

test("click mapping resolves columns against the tab hit ranges", () => {
	const at = Date.now();
	// SGR columns are 1-based and include the 2-column gutter.
	assert.equal(mapClickToTab({ at, column: 3, row: 1 }, CLICK_HITS), "status");
	assert.equal(mapClickToTab({ at, column: 12, row: 1 }, CLICK_HITS), "skills");
	// Gap between labels, the gutter itself, and any other row are misses.
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
	// Stale (dead renderer) and implausible timestamps are rejected.
	assert.equal(parseClickRequest({ at: now - 10_000, column: 12, row: 1 }, now), null);
	assert.equal(parseClickRequest({ at: now + 60_000, column: 12, row: 1 }, now), null);
	// Malformed payloads never throw.
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
	// Consumed: a second poll must not re-apply the same click.
	assert.equal(consumeClickRequest(path), null);

	rmSync(path, { force: true });
});

test("status face drops the skill HUD but keeps model and context", () => {
	const bridge = new SkillBridge();
	const lines = buildPaneLines({
		width: 32,
		bridge,
		face: "status",
		sessionTitle: "my-session",
		modelId: "m",
		thinkingLevel: "off",
		contextPercent: null,
		git: { branch: null, dirty: false, ahead: 0, behind: 0 },
		cwd: process.cwd(),
		color: (_token: string, text: string) => text,
	});
	const all = lines.join("\n");

	assert.ok(all.includes("my-session"));
	assert.ok(!all.includes("Waiting for pi-plugin-dev"));
	assert.ok(all.includes("MODEL"));
	assert.ok(all.includes("CONTEXT"));
});
