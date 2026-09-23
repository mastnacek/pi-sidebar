import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { registerSidebarCommands } from "./src/commands.js";
import {
	CONFIG_ENTRY_TYPE,
	getActiveConfig,
	resolveEffectiveConfig,
	setActiveConfig,
} from "./src/config.js";
import { SidebarAwareEditor } from "./src/editor-wrapper.js";
import { refreshKimiQuota, refreshZaiQuota } from "./src/quota.js";
import { SidebarComponent } from "./src/sidebar-component.js";
import { SkillBridge } from "./src/skills-tab.js";
import { nextTab } from "./src/tabs.js";
import type {
	FooterDataProviderLike,
	SidebarConfig,
	SidebarTab,
} from "./src/types.js";

/**
 * Marks our `setFooter` capture wrapper on the shared `ctx.ui` object.
 *
 * `ctx.ui` is `runner.uiContext` — one instance shared by every extension and
 * reused across handler invocations (pi's `ExtensionRunner.createContext()`
 * exposes `get ui() { return runner.uiContext; }`). Assigning to it is therefore
 * a process-wide mutation, so the wrapper must be installed at most once and
 * removed on shutdown. Without the guard every `session_start` (startup / new /
 * resume / fork / reload) nests another wrapper and leaks another
 * `onBranchChange` subscription.
 */
const FOOTER_CAPTURE_SYMBOL = Symbol.for("pi-sidebar.footer-capture");

type FooterCaptureHost = { [key: symbol]: { restore: () => void } | undefined };

/**
 * Install a one-shot `setFooter` wrapper that captures the live
 * `FooterDataProvider` (MCP/LSP statuses). Idempotent: repeated calls return the
 * existing restore function instead of stacking wrappers.
 */
function ensureFooterCapture(
	ui: ExtensionContext["ui"],
	onFooterData: (data: FooterDataProviderLike) => void,
): () => void {
	// SAFETY: `ctx.ui` is a plain object at runtime and we only attach a single
	// non-enumerable, symbol-keyed slot to it. `ExtensionUIContext` declares no
	// symbol index signature, so the widening is needed to carry our marker.
	const host = ui as unknown as FooterCaptureHost;
	const existing = host[FOOTER_CAPTURE_SYMBOL];
	if (existing) return existing.restore;

	type FooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	const originalSetFooter = ui.setFooter.bind(ui);

	ui.setFooter = (factory: FooterFactory) => {
		if (typeof factory !== "function") return originalSetFooter(factory);
		const wrappedFactory = (
			tui: TUI,
			theme: Theme,
			footerData: FooterDataProviderLike,
		) => {
			onFooterData(footerData);
			return (
				factory as (t: TUI, th: Theme, fd: FooterDataProviderLike) => Component
			)(tui, theme, footerData);
		};
		// SAFETY: wrappedFactory forwards the documented factory signature plus telemetry.
		return originalSetFooter(wrappedFactory as unknown as FooterFactory);
	};

	const restore = (): void => {
		ui.setFooter = originalSetFooter;
		delete host[FOOTER_CAPTURE_SYMBOL];
	};
	Object.defineProperty(host, FOOTER_CAPTURE_SYMBOL, {
		value: { restore },
		configurable: true,
		enumerable: false,
	});
	return restore;
}

class InvisibleMountComponent implements Component {
	render(_width: number): string[] {
		return [];
	}
	invalidate(): void {}
}

export default function (pi: ExtensionAPI): void {
	let overlayHandle: OverlayHandle | null = null;
	let sidebarComponent: SidebarComponent | null = null;
	let currentTui: TUI | null = null;
	let currentContext: ExtensionContext | null = null;
	let currentTheme: Theme | null = null;
	let capturedFooterData: FooterDataProviderLike | null = null;
	let unsubBranch: (() => void) | null = null;
	let lastNonMinimalPreset: SidebarConfig["preset"] | null = null;
	let busy = false;
	let busyInterval: ReturnType<typeof setInterval> | null = null;
	/** Read-only subscriber to pi-plugin-dev's published skill snapshot. */
	const skillBridge = new SkillBridge();
	/** Undoes the shared `ctx.ui.setFooter` capture installed on session_start. */
	let restoreFooterCapture: (() => void) | null = null;

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

	/** Track agent-busy state for the LSP spinner; polls render while active. */
	function setBusy(next: boolean): void {
		if (busy === next) return;
		busy = next;
		sidebarComponent?.updateBusy(busy);
		if (busy && !busyInterval) {
			// Spinner animation + MCP/LSP freshness during long-running turns
			busyInterval = setInterval(() => refreshUI(), 300);
		} else if (!busy && busyInterval) {
			clearInterval(busyInterval);
			busyInterval = null;
		}
		refreshUI();
	}

	const refreshUI = () => {
		if (currentTui && currentContext && currentTheme) {
			if (sidebarComponent) {
				sidebarComponent.updateContext(currentContext);
				sidebarComponent.updateTheme(currentTheme);
				if (capturedFooterData) {
					sidebarComponent.updateFooterData(capturedFooterData);
				}
			}
			currentTui.requestRender();
		}
	};

	// Repaint as soon as pi-plugin-dev publishes a new skill snapshot, instead of
	// waiting for the next engine event to happen to fire first.
	skillBridge.setOnChange(() => refreshUI());

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

	function applySidebar(
		tui: TUI,
		ctx: ExtensionContext,
		theme: Theme,
		configOverride?: SidebarConfig,
	): void {
		currentTui = tui;
		currentContext = ctx;
		currentTheme = theme;

		const config = configOverride ?? resolveEffectiveConfig(ctx);
		setActiveConfig(config);

		if (overlayHandle) {
			overlayHandle.hide();
			overlayHandle = null;
		}

		if (!config.enabled) {
			if (ctx.hasUI) ctx.ui.setEditorComponent(undefined);
			tui.requestRender();
			return;
		}

		if (sidebarComponent) {
			sidebarComponent.updateContext(ctx);
			sidebarComponent.updateTheme(theme);
			if (capturedFooterData) {
				sidebarComponent.updateFooterData(capturedFooterData);
			}
		} else {
			sidebarComponent = new SidebarComponent(tui, pi, ctx, theme, skillBridge);
			if (capturedFooterData) {
				sidebarComponent.updateFooterData(capturedFooterData);
			}
		}

		overlayHandle = tui.showOverlay(sidebarComponent, {
			anchor: "top-right",
			width: config.width,
			maxHeight: "100%",
			margin: { top: 0, right: 0, bottom: 0 },
			nonCapturing: true,
			visible: (termWidth: number) => {
				const active = getActiveConfig();
				return active.enabled && termWidth >= active.minTerminalWidth;
			},
		});

		// Wrap the input editor so it stops before the sidebar
		if (ctx.hasUI) {
			ctx.ui.setEditorComponent((t, th, kb) => new SidebarAwareEditor(t, th, kb));
		}

		pollActiveQuotas();
		tui.requestRender();
	}

	/** Switch the panel tab, persist it, and repaint. */
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

	function toggleSidebar(ctx: ExtensionContext): void {
		const current = getActiveConfig();
		const goingMinimal = current.preset !== "minimal";
		const next: SidebarConfig = {
			...current,
			enabled: true,
			preset: goingMinimal ? "minimal" : (lastNonMinimalPreset ?? "detailed"),
		};
		if (goingMinimal) {
			lastNonMinimalPreset = current.preset;
		}
		// Mirror /sidebar preset width heuristics: gauge strip needs ~10 cols,
		// other presets need room to breathe.
		if (next.preset === "minimal" && next.width > 12) {
			next.width = 10;
		} else if (next.preset !== "minimal" && next.width < 16) {
			next.width = 28;
		}
		setActiveConfig(next);
		pi.appendEntry(CONFIG_ENTRY_TYPE, next);
		if (currentTui && currentTheme) {
			applySidebar(currentTui, ctx, currentTheme, next);
		}
		notify(
			ctx,
			`Postranní panel: styl "${next.preset}" (šířka ${next.width} sloupců)`,
			"info",
		);
	}

	function resizeSidebar(delta: number, ctx: ExtensionContext): void {
		const current = getActiveConfig();
		const newWidth = Math.max(8, Math.min(60, current.width + delta));
		const next: SidebarConfig = { ...current, width: newWidth, enabled: true };
		setActiveConfig(next);
		pi.appendEntry(CONFIG_ENTRY_TYPE, next);
		if (currentTui && currentTheme) {
			applySidebar(currentTui, ctx, currentTheme, next);
		}
		notify(ctx, `Šířka postranního panelu: ${newWidth} sloupců`, "info");
	}

	// 1. Session start lifecycle hook
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		currentContext = ctx;
		if (!ctx.hasUI || ctx.mode !== "tui") return;

		// Capture the live footer data provider (MCP/LSP statuses) through a
		// one-shot wrapper on the shared ctx.ui singleton. Idempotent across
		// session_start and restored in session_shutdown.
		restoreFooterCapture = ensureFooterCapture(ctx.ui, (footerData) => {
			capturedFooterData = footerData;
			if (sidebarComponent) {
				sidebarComponent.updateFooterData(footerData);
			}
			unsubBranch?.();
			unsubBranch = footerData?.onBranchChange?.(() => {
				refreshUI();
			});
		});

		// Subscribe to pi-plugin-dev before mounting so the Skills tab renders
		// from the first frame.
		skillBridge.attach(pi);
		skillBridge.reset();

		// Mount invisible widget to obtain live TUI reference and trigger overlay setup
		ctx.ui.setWidget("pi-sidebar-mount", (tui: TUI, theme: Theme) => {
			applySidebar(tui, ctx, theme);
			return new InvisibleMountComponent();
		});
	});

	// 2. Re-render triggers across session lifecycle
	pi.on("turn_start", (_event, ctx) => {
		currentContext = ctx;
		refreshUI();
	});

	pi.on("turn_end", (_event, ctx) => {
		currentContext = ctx;
		pollActiveQuotas();
		refreshUI();
	});

	pi.on("message_start", refreshUI);
	pi.on("message_update", refreshUI);
	pi.on("message_end", refreshUI);
	pi.on("tool_execution_start", refreshUI);
	pi.on("tool_execution_end", refreshUI);
	pi.on("agent_start", () => setBusy(true));
	pi.on("agent_settled", () => setBusy(false));
	pi.on("model_select", (_event, ctx) => {
		currentContext = ctx;
		pollActiveQuotas(true);
		refreshUI();
	});
	pi.on("thinking_level_select", refreshUI);
	pi.on("session_compact", refreshUI);
	pi.on("session_info_changed", refreshUI);

	// 3. Cleanup on shutdown
	pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
		if (busyInterval) {
			clearInterval(busyInterval);
			busyInterval = null;
		}
		busy = false;
		if (overlayHandle) {
			overlayHandle.hide();
			overlayHandle = null;
		}
		unsubBranch?.();
		unsubBranch = null;
		// Undo the process-wide mutations we installed on the shared ctx.ui object.
		restoreFooterCapture?.();
		restoreFooterCapture = null;
		capturedFooterData = null;
		skillBridge.detach();
		if (ctx.hasUI) ctx.ui.setEditorComponent(undefined);
		sidebarComponent = null;
		currentTui = null;
	});

	// 4. Keyboard shortcuts for collapsing, resizing and tab switching
	pi.registerShortcut("ctrl+shift+t", {
		description: "Přepnout záložku postranního panelu (Status ↔ Skills)",
		handler: (ctx) => {
			setTab(ctx, nextTab(getActiveConfig().tab, 1));
		},
	});

	pi.registerShortcut("ctrl+shift+b", {
		description: "Přepnout minimal pruh / předchozí styl postranního panelu",
		handler: (ctx) => {
			toggleSidebar(ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+right", {
		description: "Zvětšit šířku postranního panelu (+4 sloupce)",
		handler: (ctx) => {
			resizeSidebar(4, ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+left", {
		description: "Zmenšit šířku postranního panelu (-4 sloupce)",
		handler: (ctx) => {
			resizeSidebar(-4, ctx);
		},
	});

	// 5. Slash command controller
	registerSidebarCommands(pi, (newConfig, ctx) => {
		if (currentTui && currentTheme) {
			applySidebar(currentTui, ctx, currentTheme, newConfig);
		}
	});
}
