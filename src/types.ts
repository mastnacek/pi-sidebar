export type SidebarPreset = "opencode" | "compact" | "detailed" | "minimal";
export type SidebarBranding = "opencode" | "pi" | "custom";
/**
 * Where the panel is drawn: inside pi's own TUI as an overlay, or in a separate
 * herdr pane fed by a snapshot file.
 */
export type SidebarPaneMode = "overlay" | "herdr";
/** Switchable panel faces. `status` = telemetry, `skills` = pi-plugin-dev skill HUD. */
export type SidebarTab = "status" | "skills";
export type SidebarBorderStyle =
	| "line"
	| "double"
	| "dotted"
	| "space"
	| "none";

export interface SidebarConfig {
	enabled: boolean;
	width: number;
	minTerminalWidth: number;
	preset: SidebarPreset;
	branding: SidebarBranding;
	customBrandingText?: string;
	borderStyle: SidebarBorderStyle;
	/** Active panel tab. */
	tab: SidebarTab;
	/** Show the clickable tab bar at the top of the panel. */
	showTabBar: boolean;
	/** Render inside pi's TUI (overlay) or in a dedicated herdr pane. */
	paneMode: SidebarPaneMode;
	/** Width in columns of the herdr pane (ignored in overlay mode). */
	paneWidth: number;
	/** Keep the herdr pane open (with a final frame) after the session ends. */
	paneKeepAlive: boolean;
	showSession: boolean;
	showModel: boolean;
	showContext: boolean;
	showCache: boolean;
	showQuota: boolean;
	showMcp: boolean;
	showLsp: boolean;
	showExtensions: boolean;
	showGit: boolean;
}

export interface SessionStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	contextTokens: number | null;
	contextWindow: number;
	contextPercent: number | null;
	cacheHitRate?: number;
}

export interface GitInfo {
	branch: string | null;
	dirty: boolean;
	ahead: number;
	behind: number;
}

export interface KimiUsageEntry {
	limit?: string;
	used?: string;
	remaining?: string;
	resetTime?: string;
}

export interface KimiUsages {
	usage?: KimiUsageEntry;
	limits?: Array<{
		window?: { duration?: number; timeUnit?: string };
		detail?: KimiUsageEntry;
	}>;
}

export interface ZaiLimit {
	type: string;
	unit?: number;
	number?: number;
	percentage?: number;
	usage?: number;
	currentValue?: number;
	remaining?: number;
	nextResetTime?: number;
}

export interface ZaiQuota {
	limits?: ZaiLimit[];
	level?: string;
}

export interface FooterDataProviderLike {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

/**
 * Snapshot published by pi-plugin-dev on the shared event bus
 * (`pi.events`, channel `pi-plugin-dev:state`).
 *
 * Mirrored here rather than imported so pi-sidebar keeps working when
 * pi-plugin-dev is not installed, and so the two packages stay decoupled.
 */
export interface SkillStateSnapshot {
	live: boolean;
	activeSkill?: string;
	references: Array<{ name: string; summary: string }>;
	actions: Array<{
		type: string;
		target: string;
		summary: string;
		timestamp: number;
	}>;
	compliance: Array<{
		rule: string;
		label: string;
		status: string;
		details: string;
	}>;
	inspectedCount: number;
	modifiedCount: number;
	startTime: number;
	lastUpdateTime: number;
	inTurn: boolean;
	turnCount: number;
}
