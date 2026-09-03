import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	SidebarBorderStyle,
	SidebarBranding,
	SidebarConfig,
	SidebarPreset,
} from "./types.js";

export const CONFIG_ENTRY_TYPE = "pi-sidebar-config";

export const GLOBAL_CONFIG_PATH = join(
	homedir(),
	".pi",
	"agent",
	"pi-sidebar.json",
);

export const DEFAULT_CONFIG: SidebarConfig = {
	enabled: true,
	width: 28,
	minTerminalWidth: 80,
	preset: "opencode",
	branding: "pi",
	borderStyle: "line",
	showSession: true,
	showModel: true,
	showContext: true,
	showCache: true,
	showQuota: true,
	showMcp: true,
	showLsp: true,
	showExtensions: true,
	showGit: true,
};

let activeConfig: SidebarConfig = { ...DEFAULT_CONFIG };

export function getActiveConfig(): SidebarConfig {
	return activeConfig;
}

export function setActiveConfig(config: SidebarConfig): void {
	activeConfig = { ...config };
}

export function loadGlobalConfig(): Partial<SidebarConfig> {
	try {
		if (existsSync(GLOBAL_CONFIG_PATH)) {
			const data = JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf8"));
			if (data && typeof data === "object") {
				return data as Partial<SidebarConfig>;
			}
		}
	} catch {
		// Non-fatal
	}
	return {};
}

export function saveGlobalConfig(config: SidebarConfig): void {
	try {
		mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
		writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
	} catch {
		// Non-fatal
	}
}

function resolveBoolean(
	sessionVal?: boolean,
	globalVal?: boolean,
	fallback = true,
): boolean {
	if (typeof sessionVal === "boolean") return sessionVal;
	if (typeof globalVal === "boolean") return globalVal;
	return fallback;
}

function resolveNumber(
	sessionVal?: number,
	globalVal?: number,
	fallback = 28,
	min = 16,
	max = 60,
): number {
	if (typeof sessionVal === "number" && sessionVal >= min && sessionVal <= max) {
		return sessionVal;
	}
	if (typeof globalVal === "number" && globalVal >= min && globalVal <= max) {
		return globalVal;
	}
	return fallback;
}

function resolvePreset(
	sessionVal?: string,
	globalVal?: string,
	fallback: SidebarPreset = "opencode",
): SidebarPreset {
	const valid: SidebarPreset[] = ["opencode", "compact", "detailed", "minimal"];
	if (sessionVal && valid.includes(sessionVal as SidebarPreset))
		return sessionVal as SidebarPreset;
	if (globalVal && valid.includes(globalVal as SidebarPreset))
		return globalVal as SidebarPreset;
	return fallback;
}

function resolveBranding(
	sessionVal?: string,
	globalVal?: string,
	fallback: SidebarBranding = "pi",
): SidebarBranding {
	const valid: SidebarBranding[] = ["opencode", "pi", "custom"];
	if (sessionVal && valid.includes(sessionVal as SidebarBranding))
		return sessionVal as SidebarBranding;
	if (globalVal && valid.includes(globalVal as SidebarBranding))
		return globalVal as SidebarBranding;
	return fallback;
}

function resolveBorderStyle(
	sessionVal?: string,
	globalVal?: string,
	fallback: SidebarBorderStyle = "line",
): SidebarBorderStyle {
	const valid: SidebarBorderStyle[] = [
		"line",
		"double",
		"dotted",
		"space",
		"none",
	];
	if (sessionVal && valid.includes(sessionVal as SidebarBorderStyle))
		return sessionVal as SidebarBorderStyle;
	if (globalVal && valid.includes(globalVal as SidebarBorderStyle))
		return globalVal as SidebarBorderStyle;
	return fallback;
}

export function resolveEffectiveConfig(ctx: ExtensionContext): SidebarConfig {
	const globalCfg = loadGlobalConfig();
	let sessionCfg: Partial<SidebarConfig> | null = null;

	try {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (
				entry.type === "custom" &&
				entry.customType === CONFIG_ENTRY_TYPE &&
				entry.data &&
				typeof entry.data === "object"
			) {
				sessionCfg = entry.data as Partial<SidebarConfig>;
			}
		}
	} catch {
		// Non-fatal
	}

	const resolved: SidebarConfig = {
		enabled: resolveBoolean(
			sessionCfg?.enabled,
			globalCfg.enabled,
			DEFAULT_CONFIG.enabled,
		),
		width: resolveNumber(
			sessionCfg?.width,
			globalCfg.width,
			DEFAULT_CONFIG.width,
			8,
			60,
		),
		minTerminalWidth: resolveNumber(
			sessionCfg?.minTerminalWidth,
			globalCfg.minTerminalWidth,
			DEFAULT_CONFIG.minTerminalWidth,
			40,
			200,
		),
		preset: resolvePreset(
			sessionCfg?.preset,
			globalCfg.preset,
			DEFAULT_CONFIG.preset,
		),
		branding: resolveBranding(
			sessionCfg?.branding,
			globalCfg.branding,
			DEFAULT_CONFIG.branding,
		),
		customBrandingText:
			sessionCfg?.customBrandingText ?? globalCfg.customBrandingText,
		borderStyle: resolveBorderStyle(
			sessionCfg?.borderStyle,
			globalCfg.borderStyle,
			DEFAULT_CONFIG.borderStyle,
		),
		showSession: resolveBoolean(
			sessionCfg?.showSession,
			globalCfg.showSession,
			DEFAULT_CONFIG.showSession,
		),
		showModel: resolveBoolean(
			sessionCfg?.showModel,
			globalCfg.showModel,
			DEFAULT_CONFIG.showModel,
		),
		showContext: resolveBoolean(
			sessionCfg?.showContext,
			globalCfg.showContext,
			DEFAULT_CONFIG.showContext,
		),
		showCache: resolveBoolean(
			sessionCfg?.showCache,
			globalCfg.showCache,
			DEFAULT_CONFIG.showCache,
		),
		showQuota: resolveBoolean(
			sessionCfg?.showQuota,
			globalCfg.showQuota,
			DEFAULT_CONFIG.showQuota,
		),
		showMcp: resolveBoolean(
			sessionCfg?.showMcp,
			globalCfg.showMcp,
			DEFAULT_CONFIG.showMcp,
		),
		showLsp: resolveBoolean(
			sessionCfg?.showLsp,
			globalCfg.showLsp,
			DEFAULT_CONFIG.showLsp,
		),
		showExtensions: resolveBoolean(
			sessionCfg?.showExtensions,
			globalCfg.showExtensions,
			DEFAULT_CONFIG.showExtensions,
		),
		showGit: resolveBoolean(
			sessionCfg?.showGit,
			globalCfg.showGit,
			DEFAULT_CONFIG.showGit,
		),
	};

	activeConfig = resolved;
	return resolved;
}
