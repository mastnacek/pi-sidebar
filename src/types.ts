export type SidebarPreset = "opencode" | "compact" | "detailed";
export type SidebarBranding = "opencode" | "pi" | "custom";
export type SidebarBorderStyle = "line" | "double" | "dotted" | "space" | "none";

export interface SidebarConfig {
	enabled: boolean;
	width: number;
	minTerminalWidth: number;
	preset: SidebarPreset;
	branding: SidebarBranding;
	customBrandingText?: string;
	borderStyle: SidebarBorderStyle;
	showLsp: boolean;
	showContext: boolean;
	showGit: boolean;
	showSession: boolean;
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
}

export interface GitInfo {
	branch: string | null;
	dirty: boolean;
	ahead: number;
	behind: number;
}
