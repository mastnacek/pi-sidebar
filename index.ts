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
import type { FooterDataProviderLike, SidebarConfig } from "./src/types.js";

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
			ctx.ui.setEditorComponent(undefined);
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
			sidebarComponent = new SidebarComponent(tui, pi, ctx, theme);
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
		ctx.ui.setEditorComponent((t, th, kb) => new SidebarAwareEditor(t, th, kb));

		pollActiveQuotas();
		tui.requestRender();
	}

	function toggleSidebar(ctx: ExtensionContext): void {
		const current = getActiveConfig();
		const next: SidebarConfig = { ...current, enabled: !current.enabled };
		setActiveConfig(next);
		pi.appendEntry(CONFIG_ENTRY_TYPE, next);
		if (currentTui && currentTheme) {
			applySidebar(currentTui, ctx, currentTheme, next);
		}
		ctx.ui.notify(
			`Postranní panel ${next.enabled ? `rozbalen (${next.width} sloupců)` : "sbalen («)"}`,
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
		ctx.ui.notify(`Šířka postranního panelu: ${newWidth} sloupců`, "info");
	}

	// 1. Session start lifecycle hook
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		currentContext = ctx;
		if (!ctx.hasUI || ctx.mode !== "tui") return;

		// Intercept setFooter to transparently capture live footerData
		type FooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		const originalSetFooter = ctx.ui.setFooter.bind(ctx.ui);
		ctx.ui.setFooter = (factory: FooterFactory) => {
			if (typeof factory === "function") {
				const wrappedFactory = (
					tui: TUI,
					theme: Theme,
					footerData: FooterDataProviderLike,
				) => {
					capturedFooterData = footerData;
					if (sidebarComponent) {
						sidebarComponent.updateFooterData(footerData);
					}
					unsubBranch?.();
					unsubBranch = footerData?.onBranchChange?.(() => {
						refreshUI();
					});
					return (
						factory as (t: TUI, th: Theme, fd: FooterDataProviderLike) => Component
					)(tui, theme, footerData);
				};
				// SAFETY: wrappedFactory matches the FooterFactory signature with injected telemetry interception
				return originalSetFooter(wrappedFactory as unknown as FooterFactory);
			}
			return originalSetFooter(factory);
		};

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
	pi.on("model_select", (_event, ctx) => {
		currentContext = ctx;
		pollActiveQuotas(true);
		refreshUI();
	});
	pi.on("thinking_level_select", refreshUI);
	pi.on("session_compact", refreshUI);
	pi.on("session_info_changed", refreshUI);

	// 3. Cleanup on shutdown
	pi.on("session_shutdown", () => {
		if (overlayHandle) {
			overlayHandle.hide();
			overlayHandle = null;
		}
		unsubBranch?.();
		unsubBranch = null;
		sidebarComponent = null;
		currentTui = null;
	});

	// 4. Keyboard shortcuts for collapsing and resizing
	pi.registerShortcut("ctrl+shift+b", {
		description: "Přepnout sbalení / rozbalení postranního panelu («)",
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
