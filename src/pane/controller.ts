import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { getGitInfo } from "../git.js";
import type { SkillBridge } from "../skills-tab.js";
import { getSessionStats, isAutoCompactEnabled } from "../stats.js";
import type { TabHitRange } from "../tabs.js";
import type { SidebarConfig, SidebarTab } from "../types.js";
import { mapClickToTab } from "./click.js";
import { buildPaneFrame, type PaneColor } from "./lines.js";
import {
	PANE_LABEL,
	closePane,
	findSidebarPane,
	herdrBinary,
	clampPaneWidth,
	isHerdrSession,
	currentPaneId,
	currentTabId,
	renamePane,
	runRendererInPane,
	splitPane,
} from "./herdr.js";
import {
	PANE_SNAPSHOT_VERSION,
	type PaneSnapshot,
	consumeClickRequest,
	resolveRequestPath,
	resolveSnapshotPath,
	writePaneSnapshot,
} from "./snapshot.js";

/**
 * Coalescing window for snapshot writes. The extension calls `push()` on every
 * engine event (and ~3×/s while the agent is busy), but the pane only needs a few
 * frames per second; writing a ~2 KB file at engine-event rate would be pure I/O
 * churn. Writes are additionally deduplicated by content.
 */
const MIN_WRITE_INTERVAL_MS = 250;

/** Renderer polling interval, in ms (its cost is one `statSync` per tick). */
const RENDERER_POLL_MS = 300;

/** How often the extension collects a pending tab click from the pane. */
const REQUEST_POLL_MS = 250;

/**
 * herdr gives the pane a PTY two columns narrower than its layout rect (its
 * scrollback indicator), verified against a 32-column pane: the renderer's TTY
 * reports 30 usable columns. `paneWidth` stays the rect width so the split maths
 * match the default herdr sidebar, while the frame is built for the inner width.
 */
const PANE_CHROME_COLUMNS = 2;

export interface PaneControllerOptions {
	pi: ExtensionAPI;
	bridge: SkillBridge;
	/** Absolute path to `src/pane/renderer.mjs`. */
	rendererPath: string;
	/** Runtime for the renderer; defaults to the node running pi. */
	nodeBinary?: string;
	/** Called when a pane click resolves to a tab (wired to `setTab`). */
	onTabRequest?: (tab: SidebarTab) => void;
}

/**
 * Owns the herdr pane that mirrors the sidebar face, and the snapshot file that
 * feeds it. Contains no model calls and appends nothing to LLM context: it only
 * writes a local JSON file and invokes the herdr CLI.
 */
export class PaneController {
	private readonly pi: ExtensionAPI;
	private readonly bridge: SkillBridge;
	private readonly rendererPath: string;
	private readonly nodeBinary: string;

	private paneId: string | null = null;
	private snapshotPath: string | null = null;
	private snapshotKey: string | null = null;
	private theme: Theme | null = null;
	private revision = 0;
	private lastWriteAt = 0;
	private lastSignature = "";
	private pendingTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingArgs: { ctx: ExtensionContext; config: SidebarConfig } | null =
		null;
	private requestTimer: ReturnType<typeof setInterval> | null = null;
	/** Hit ranges from the last painted frame, used to resolve clicks. */
	private lastTabHits: readonly TabHitRange[] = [];
	private readonly onTabRequest: ((tab: SidebarTab) => void) | null;

	constructor(options: PaneControllerOptions) {
		this.pi = options.pi;
		this.bridge = options.bridge;
		this.rendererPath = options.rendererPath;
		this.nodeBinary = options.nodeBinary ?? process.execPath;
		this.onTabRequest = options.onTabRequest ?? null;
	}

	isActive(): boolean {
		return this.paneId !== null;
	}

	getPaneId(): string | null {
		return this.paneId;
	}

	getSnapshotPath(): string | null {
		return this.snapshotPath;
	}

	setTheme(theme: Theme): void {
		this.theme = theme;
	}

	/**
	 * Find-or-create the pane and start the renderer. Returns false (and leaves no
	 * state behind) when herdr is unavailable, so the caller can fall back to the
	 * overlay.
	 */
	start(ctx: ExtensionContext, config: SidebarConfig): boolean {
		if (!isHerdrSession()) return false;
		const bin = herdrBinary();
		const tabId = currentTabId();
		const ownPane = currentPaneId();
		if (!bin || !tabId || !ownPane) return false;

		const width = clampPaneWidth(config.paneWidth);
		const existing = findSidebarPane(bin, tabId);
		const paneId = existing?.pane_id ?? splitPane(bin, ctx.cwd, width);
		if (!paneId) return false;

		this.paneId = paneId;
		this.snapshotKey = ownPane;
		this.snapshotPath = resolveSnapshotPath(ownPane);
		this.lastSignature = "";
		this.lastWriteAt = 0;
		this.lastTabHits = [];

		// Label first so a later `findSidebarPane` never adopts a stray pane.
		renamePane(bin, paneId, PANE_LABEL);
		// Write before spawning, so the renderer's first frame is already correct.
		this.writeNow(ctx, config, true);
		if (!existing) {
			runRendererInPane(
				bin,
				paneId,
				this.nodeBinary,
				this.rendererPath,
				this.snapshotPath,
				RENDERER_POLL_MS,
			);
		}
		this.startRequestPolling();
		return true;
	}

	/** Throttled, content-deduplicated snapshot update. Safe to call on any event. */
	push(ctx: ExtensionContext, config: SidebarConfig): void {
		if (!this.snapshotPath) {
			const ownPane = currentPaneId();
			if (ownPane) {
				this.snapshotPath = resolveSnapshotPath(ownPane);
				this.snapshotKey = ownPane;
			}
		}
		if (!this.snapshotPath) return;

		const elapsed = Date.now() - this.lastWriteAt;
		if (elapsed >= MIN_WRITE_INTERVAL_MS) {
			this.writeNow(ctx, config, true);
			return;
		}
		// Trailing write so the final state of a burst is never lost.
		this.pendingArgs = { ctx, config };
		if (this.pendingTimer) return;
		this.pendingTimer = setTimeout(() => {
			this.pendingTimer = null;
			const args = this.pendingArgs;
			this.pendingArgs = null;
			if (args) this.writeNow(args.ctx, args.config, true);
		}, MIN_WRITE_INTERVAL_MS - elapsed);
		if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
	}

	/**
	 * Stop the controller. `close` controls pane disposal:
	 * - close=true (default, /sidebar off, session end without keep-alive): close pane.
	 * - close=false (extension reload): keep the pane and its renderer alive so the
	 *   next session instance can adopt it and continue pushing snapshots. Nothing
	 *   is written — a live renderer just keeps polling until the new instance
	 *   refreshes the file.
	 */
	stop(config: SidebarConfig, close = true): void {
		if (this.pendingTimer) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
		}
		if (this.requestTimer) {
			clearInterval(this.requestTimer);
			this.requestTimer = null;
		}
		this.pendingArgs = null;
		const bin = herdrBinary();
		const paneId = this.paneId;
		if (bin && paneId) {
			if (!close) {
				// Reload: leave the pane and renderer untouched.
			} else if (config.paneKeepAlive) {
				this.writeDead("session ended");
			} else {
				closePane(bin, paneId);
			}
		}
		this.paneId = null;
		this.snapshotPath = null;
		this.snapshotKey = null;
		this.lastSignature = "";
		this.lastTabHits = [];
	}

	/**
	 * Collect tab clicks left by the renderer. Polled rather than event-driven so a
	 * click works while the agent is idle, with no engine event to piggyback on.
	 */
	private startRequestPolling(): void {
		if (this.requestTimer) return;
		this.requestTimer = setInterval(() => this.pollClickRequest(), REQUEST_POLL_MS);
		if (typeof this.requestTimer.unref === "function") {
			this.requestTimer.unref();
		}
	}

	private pollClickRequest(): void {
		const path = this.snapshotPath;
		if (!path || !this.onTabRequest) return;
		const request = consumeClickRequest(resolveRequestPath(path));
		if (!request) return;
		const tab = mapClickToTab(request, this.lastTabHits);
		if (tab) this.onTabRequest(tab);
	}

	/**
	 * Repaint the pane from current context. `lines` is content-addressed: an
	 * unchanged frame costs one `JSON.stringify`, no file write.
	 */
	private writeNow(
		ctx: ExtensionContext,
		config: SidebarConfig,
		live: boolean,
	): void {
		const path = this.snapshotPath;
		if (!path) return;

		const width = clampPaneWidth(config.paneWidth);
		const color: PaneColor = (token, text) => {
			try {
				return this.theme ? this.theme.fg(token as never, text) : text;
			} catch {
				return text;
			}
		};

		const usage = ctx.getContextUsage();
		const stats = getSessionStats(ctx);
		let sessionName: string | null = null;
		try {
			sessionName = ctx.sessionManager.getSessionName() ?? null;
		} catch {
			sessionName = null;
		}

		const frame = buildPaneFrame({
			width: Math.max(8, width - PANE_CHROME_COLUMNS),
			bridge: this.bridge,
			face: config.tab === "status" ? "status" : "skills",
			activeTab: config.tab,
			sessionTitle: sessionName,
			modelId: ctx.model?.id ?? null,
			modelProvider: ctx.model?.provider ?? null,
			modelReasoning: Boolean(ctx.model?.reasoning),
			thinkingLevel: this.pi.getThinkingLevel() ?? null,
			contextPercent: usage?.percent ?? stats.contextPercent,
			contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
			autoCompactEnabled: isAutoCompactEnabled(ctx.cwd),
			cost: stats.totalCost,
			inputTokens: stats.totalInputTokens,
			outputTokens: stats.totalOutputTokens,
			cacheRead: stats.totalCacheRead,
			cacheWrite: stats.totalCacheWrite,
			cacheHitRate: stats.cacheHitRate,
			usingSubscription: ctx.model?.provider === "kimi-coding",
			showSession: config.showSession,
			showGit: config.showGit,
			git: getGitInfo(ctx.cwd),
			cwd: ctx.cwd,
			color,
		});

		const lines = frame.lines;
		this.lastTabHits = frame.tabHits;
		const signature = lines.join("\n");
		if (live && signature === this.lastSignature) return;
		this.lastSignature = signature;

		this.revision += 1;
		const snapshot: PaneSnapshot = {
			version: PANE_SNAPSHOT_VERSION,
			live,
			key: this.snapshotKey ?? "",
			revision: this.revision,
			width,
			generatedAt: new Date().toISOString(),
			lines,
			tabHits: frame.tabHits,
		};
		if (writePaneSnapshot(path, snapshot)) this.lastWriteAt = Date.now();
	}

	private writeDead(reason: string): void {
		const path = this.snapshotPath;
		if (!path) return;
		this.revision += 1;
		writePaneSnapshot(path, {
			version: PANE_SNAPSHOT_VERSION,
			live: false,
			key: this.snapshotKey ?? "",
			revision: this.revision,
			width: 0,
			generatedAt: new Date().toISOString(),
			lines: [reason],
		});
	}
}
