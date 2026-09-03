export type SidebarPreset = "opencode" | "compact" | "detailed" | "minimal";
export type SidebarBranding = "opencode" | "pi" | "custom";
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
