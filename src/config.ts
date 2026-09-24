import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from "./pane/herdr.js";
import type { SidebarConfig, SidebarTab } from "./types.js";

export const CONFIG_ENTRY_TYPE = "pi-sidebar-config";

export const GLOBAL_CONFIG_PATH = join(
	homedir(),
	".pi",
	"agent",
	"pi-sidebar.json",
);

export const DEFAULT_CONFIG: SidebarConfig = {
	enabled: true,
	tab: "status",
	paneWidth: 40,
	paneKeepAlive: false,
	showSession: true,
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

export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-sidebar.json");
}

export function loadProjectConfig(cwd: string): Partial<SidebarConfig> {
	try {
		const filePath = projectConfigPath(cwd);
		if (existsSync(filePath)) {
			const data = JSON.parse(readFileSync(filePath, "utf8"));
			if (data && typeof data === "object") {
				return data as Partial<SidebarConfig>;
			}
		}
	} catch {
		// Non-fatal
	}
	return {};
}

export function saveProjectConfig(cwd: string, config: SidebarConfig): void {
	try {
		const filePath = projectConfigPath(cwd);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
	} catch {
		// Non-fatal
	}
}

export function saveGlobalConfig(config: SidebarConfig): void {
	try {
		mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
		writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
	} catch {
		// Non-fatal
	}
}

export function saveConfig(config: SidebarConfig, isGlobal = false, cwd?: string): void {
	if (isGlobal || !cwd) {
		saveGlobalConfig(config);
	} else {
		saveProjectConfig(cwd, config);
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
	sessionVal: number | undefined,
	globalVal: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof sessionVal === "number" && sessionVal >= min && sessionVal <= max) {
		return sessionVal;
	}
	if (typeof globalVal === "number" && globalVal >= min && globalVal <= max) {
		return globalVal;
	}
	return fallback;
}

function resolveTab(
	sessionVal?: string,
	globalVal?: string,
	fallback: SidebarTab = "status",
): SidebarTab {
	const valid: SidebarTab[] = ["status", "skills"];
	if (sessionVal && valid.includes(sessionVal as SidebarTab)) {
		return sessionVal as SidebarTab;
	}
	if (globalVal && valid.includes(globalVal as SidebarTab)) {
		return globalVal as SidebarTab;
	}
	return fallback;
}

export function resolveEffectiveConfig(ctx: ExtensionContext): SidebarConfig {
	const globalCfg = loadGlobalConfig();
	const projectCfg = ctx.cwd ? loadProjectConfig(ctx.cwd) : {};
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

	const base = { ...DEFAULT_CONFIG, ...globalCfg, ...projectCfg };

	const resolved: SidebarConfig = {
		enabled: resolveBoolean(
			sessionCfg?.enabled,
			base.enabled,
			DEFAULT_CONFIG.enabled,
		),
		tab: resolveTab(sessionCfg?.tab, base.tab, DEFAULT_CONFIG.tab),
		paneWidth: resolveNumber(
			sessionCfg?.paneWidth,
			base.paneWidth,
			DEFAULT_CONFIG.paneWidth,
			MIN_PANE_WIDTH,
			MAX_PANE_WIDTH,
		),
		paneKeepAlive: resolveBoolean(
			sessionCfg?.paneKeepAlive,
			base.paneKeepAlive,
			DEFAULT_CONFIG.paneKeepAlive,
		),
		showSession: resolveBoolean(
			sessionCfg?.showSession,
			base.showSession,
			DEFAULT_CONFIG.showSession,
		),
		showGit: resolveBoolean(
			sessionCfg?.showGit,
			base.showGit,
			DEFAULT_CONFIG.showGit,
		),
	};

	activeConfig = resolved;
	return resolved;
}
