import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { registerSidebarCommands } from "./src/commands.js";
import {
	CONFIG_ENTRY_TYPE,
	getActiveConfig,
	resolveEffectiveConfig,
	setActiveConfig,
} from "./src/config.js";
import { PaneController } from "./src/pane/controller.js";
import { isHerdrSession } from "./src/pane/herdr.js";
import { refreshKimiQuota, refreshZaiQuota } from "./src/quota.js";
import { SkillBridge } from "./src/skills-tab.js";
import { nextTab } from "./src/tabs.js";
import type { SidebarConfig, SidebarTab } from "./src/types.js";

/**
 * pi-sidebar — right-hand telemetry panel rendered **only** in a dedicated herdr
 * pane (an external terminal window, not part of the Pi TUI).
 *
 * The extension owns no overlay and never installs an editor component: it
 * writes a JSON snapshot and invokes the herdr CLI, and a standalone renderer
 * (`src/pane/renderer.mjs`) paints that snapshot inside the pane. Contains no
 * model calls and appends nothing to LLM context.
 *
 * Requires a herdr session (`HERDR_BIN_PATH` + `HERDR_PANE_ID`). Outside herdr
 * the plugin stays idle and reports that the pane is unavailable.
 */
export default function (pi: ExtensionAPI): void {
	let currentContext: ExtensionContext | null = null;
	let paneController: PaneController | null = null;
	let busy = false;
	let busyInterval: ReturnType<typeof setInterval> | null = null;
	/** Read-only subscriber to pi-plugin-dev's published skill snapshot. */
	const skillBridge = new SkillBridge();
	/** Unsubscribers from every `pi.on()`; drained on session_shutdown (AGENTS.md §5). */
	const unsubscribers: Array<() => void> = [];

	/**
	 * Capture a `pi.on()` return value and register it for shutdown cleanup.
	 *
	 * pi-tui/pi-coding-agent 0.86+ returns an unsubscribe function; the plugin's
	 * pinned dev dependency (0.84.4) still types the call as `void`, so the result
	 * is taken as `unknown` and only stored when it is actually callable. This
	 * keeps the 0.87 runtime clean without breaking the older type surface.
	 */
	function track(result: unknown): void {
		if (typeof result === "function") {
			unsubscribers.push(result as () => void);
		}
	}
	/** Standalone renderer shipped next to this file (plain ESM, zero deps). */
	const rendererPath = fileURLToPath(
		new URL("./src/pane/renderer.mjs", import.meta.url),
	);

	/** UI-safe notify: never crash a headless session (AGENTS.md §6). */
	function notify(
		ctx: ExtensionContext,
		message: string,
		type: "info" | "warning" | "error" = "info",
	): void {
		if (ctx.hasUI) {
			ctx.ui.notify(message, type);
		} else {
			console.log(message);
		}
	}

	const refreshUI = (): void => {
		// A herdr pane has no TUI render pass of its own — push a snapshot instead.
		if (!currentContext) return;
		if (!paneController || !paneController.isActive()) {
			applyPane(currentContext);
		} else {
			paneController.push(currentContext, getActiveConfig());
		}
	};

	function pollActiveQuotas(force = false): void {
		const model = currentContext?.model;
		if (model?.provider === "kimi-coding") {
			void refreshKimiQuota(force, refreshUI);
		} else if (
			model?.provider === "zai-coding-cn" ||
			model?.provider === "zai-coding"
		) {
			void refreshZaiQuota(force, refreshUI);
		}
	}

	/** Track agent-busy state; keep the pane fresh during long-running turns. */
	function setBusy(next: boolean): void {
		if (busy === next) return;
		busy = next;
		if (busy && !busyInterval) {
			busyInterval = setInterval(refreshUI, 300);
		} else if (!busy && busyInterval) {
			clearInterval(busyInterval);
			busyInterval = null;
		}
		refreshUI();
	}

	/**
	 * Reconcile the herdr pane with `config`: stop it when disabled, start it when
	 * enabled and herdr is available, otherwise push a fresh snapshot.
	 */
	function applyPane(ctx: ExtensionContext, configOverride?: SidebarConfig): void {
		currentContext = ctx;
		const config = configOverride ?? resolveEffectiveConfig(ctx);
		setActiveConfig(config);

		if (!config.enabled || !isHerdrSession()) {
			paneController?.stop(config);
			return;
		}

		if (!paneController) {
			paneController = new PaneController({
				pi,
				bridge: skillBridge,
				rendererPath,
				// A click on the pane's tab strip goes through the very same path as
				// `/sidebar tab`: persist the choice, then repaint.
				onTabRequest: (tab) => {
					if (currentContext) setTab(currentContext, tab);
				},
			});
		}

		// Theme is TUI-only; a headless context simply renders unstyled.
		try {
			paneController.setTheme(ctx.ui.theme);
		} catch {
			// Non-fatal: the pane falls back to plain text.
		}

		if (!paneController.isActive()) {
			if (!paneController.start(ctx, config)) {
				paneController = null;
				return;
			}
		} else {
			paneController.push(ctx, config);
		}
		pollActiveQuotas();
	}

	/** Switch the pane tab, persist it, and repaint. */
	function setTab(ctx: ExtensionContext, tab: SidebarTab): void {
		const current = getActiveConfig();
		if (current.tab === tab) return;
		const next: SidebarConfig = { ...current, tab };
		setActiveConfig(next);
		pi.appendEntry(CONFIG_ENTRY_TYPE, next);
		refreshUI();
		notify(
			ctx,
			`Záložka panelu: ${tab === "skills" ? "Skills (pi-plugin-dev)" : "Status"}`,
			"info",
		);
	}

	// 1. Session start: restore config, mount the pane, subscribe to pi-plugin-dev.
	track(
		pi.on("session_start", (_event, ctx: ExtensionContext) => {
			currentContext = ctx;

			// Restore persisted config from session branch/entries if present
			if (ctx.sessionManager) {
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "custom" && entry.customType === CONFIG_ENTRY_TYPE) {
						if (entry.data && typeof entry.data === "object") {
							setActiveConfig({ ...getActiveConfig(), ...(entry.data as Partial<SidebarConfig>) });
						}
					}
				}
			}

			// Subscribe to pi-plugin-dev before mounting so the Skills tab renders
			// from the first frame.
			skillBridge.attach(pi);
			skillBridge.reset();

			if (!isHerdrSession()) {
				notify(
					ctx,
					"pi-sidebar: herdr pane není dostupný — spusťte Pi v herdr.",
					"warning",
				);
				return;
			}

			applyPane(ctx);
		}),
	);

	// 2. Re-render triggers across the session lifecycle.
	track(
		pi.on("turn_start", (_event, ctx) => {
			currentContext = ctx;
			refreshUI();
		}),
	);
	track(
		pi.on("turn_end", (_event, ctx) => {
			currentContext = ctx;
			pollActiveQuotas();
			refreshUI();
		}),
	);

	track(pi.on("message_start", refreshUI));
	track(pi.on("message_update", refreshUI));
	track(pi.on("message_end", refreshUI));
	track(pi.on("tool_execution_start", refreshUI));
	track(pi.on("tool_execution_end", refreshUI));
	track(pi.on("thinking_level_select", refreshUI));
	track(pi.on("session_compact", refreshUI));
	track(pi.on("session_info_changed", refreshUI));
	track(pi.on("agent_start", () => setBusy(true)));
	track(pi.on("agent_settled", () => setBusy(false)));
	track(
		pi.on("model_select", (_event, ctx) => {
			currentContext = ctx;
			pollActiveQuotas(true);
			refreshUI();
		}),
	);

	// 3. Cleanup on shutdown: drain timers, stop the pane, release every listener.
	pi.on("session_shutdown", () => {
		if (busyInterval) {
			clearInterval(busyInterval);
			busyInterval = null;
		}
		busy = false;
		paneController?.stop(getActiveConfig());
		paneController = null;
		skillBridge.detach();
		while (unsubscribers.length > 0) {
			unsubscribers.pop()?.();
		}
		currentContext = null;
	});

	// 4. Keyboard shortcut: tab switching (width is a `/sidebar` command).
	pi.registerShortcut("ctrl+shift+t", {
		description: "Přepnout záložku herdr pane (Status ↔ Skills)",
		handler: (ctx) => {
			setTab(ctx, nextTab(getActiveConfig().tab, 1));
		},
	});

	// 5. Slash command controller.
	registerSidebarCommands(pi, (newConfig, ctx) => {
		applyPane(ctx, newConfig);
		if (newConfig.enabled && !isHerdrSession()) {
			notify(
				ctx,
				"pi-sidebar: herdr pane není dostupný — spusťte Pi v herdr.",
				"warning",
			);
		}
	});
}
