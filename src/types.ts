/** Switchable panel faces. `status` = telemetry, `skills` = pi-plugin-dev skill HUD. */
export type SidebarTab = "status" | "skills";

/**
 * Plugin configuration. pi-sidebar renders exclusively in a dedicated herdr pane
 * (see `pane/herdr.ts`); there is no in-agent overlay, so the config carries only
 * pane and content options.
 */
export interface SidebarConfig {
	/** Open/close the herdr pane. */
	enabled: boolean;
	/** Active pane face. */
	tab: SidebarTab;
	/** Width in columns requested for the herdr pane. */
	paneWidth: number;
	/** Keep the pane open (with a final frame) after the session ends. */
	paneKeepAlive: boolean;
	/** Show the `🏷️ session` segment. */
	showSession: boolean;
	/** Show the `🌿 branch ●dirty/○clean` segment. */
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
