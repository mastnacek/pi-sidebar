import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type OverlayHandle,
	type TUI,
	matchesKey,
} from "@earendil-works/pi-tui";
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
	let removeInputListener: (() => void) | null = null;

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

		// Hook direct keyboard & mouse wheel listener over sidebar region
		if (!removeInputListener) {
			try {
				process.stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
			} catch {
				// Non-fatal
			}

			removeInputListener = tui.addInputListener((data: string) => {
				const active = getActiveConfig();
				if (!active.enabled) return undefined;

				// 1. Direct Keyboard Shortcut Interception (prevents transcript hijacking)
				if (
					matchesKey(data, "ctrl+shift+up") ||
					data === "\x1b[1;6A" ||
					data.includes("\x1b[1;6A") ||
					matchesKey(data, "ctrl+shift+u")
				) {
					scrollSidebar(-3);
					return { consume: true };
				}

				if (
					matchesKey(data, "ctrl+shift+down") ||
					data === "\x1b[1;6B" ||
					data.includes("\x1b[1;6B") ||
					matchesKey(data, "ctrl+shift+d")
				) {
					scrollSidebar(3);
					return { consume: true };
				}

				if (
					matchesKey(data, "ctrl+shift+pageUp") ||
					data === "\x1b[5;6~" ||
					data.includes("\x1b[5;6~")
				) {
					scrollSidebar(-10);
					return { consume: true };
				}

				if (
					matchesKey(data, "ctrl+shift+pageDown") ||
					data === "\x1b[6;6~" ||
					data.includes("\x1b[6;6~")
				) {
					scrollSidebar(10);
					return { consume: true };
				}

				if (
					matchesKey(data, "ctrl+shift+right") ||
					data === "\x1b[1;6C" ||
					data.includes("\x1b[1;6C")
				) {
					if (currentContext) resizeSidebar(4, currentContext);
					return { consume: true };
				}

				if (
					matchesKey(data, "ctrl+shift+left") ||
					data === "\x1b[1;6D" ||
					data.includes("\x1b[1;6D")
				) {
					if (currentContext) resizeSidebar(-4, currentContext);
					return { consume: true };
				}

				// 2. SGR Mouse Protocol: \x1b[<button;col;row;M or m
				const sgrMatches = Array.from(
					data.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g),
				);
				if (sgrMatches.length > 0) {
					const termWidth =
						tui.terminal?.columns || process.stdout?.columns || 80;
					const sidebarStartCol = Math.max(1, termWidth - active.width + 1);

					for (const match of sgrMatches) {
						const button = Number.parseInt(match[1], 10);
						const col = Number.parseInt(match[2], 10);

						if (col >= sidebarStartCol && col <= termWidth) {
							// Button 64 = wheel up, 65 = wheel down (with optional modifier bits: 68, 72 / 69, 73)
							if (
								button === 64 ||
								button === 68 ||
								button === 72 ||
								(button >= 64 && (button & 64) !== 0 && (button & 1) === 0)
							) {
								scrollSidebar(-3);
								return { consume: true };
							}
							if (
								button === 65 ||
								button === 69 ||
								button === 73 ||
								(button >= 64 && (button & 64) !== 0 && (button & 1) === 1)
							) {
								scrollSidebar(3);
								return { consume: true };
							}
						}
					}
				}

				// 3. Normal X10 / UTF-8 Mouse Protocol: \x1b[M <cb+32> <cx+32> <cy+32>
				if (data.includes("\x1b[M")) {
					const idx = data.indexOf("\x1b[M");
					if (data.length >= idx + 6) {
						const cb = data.charCodeAt(idx + 3) - 32;
						const cx = data.charCodeAt(idx + 4) - 32;
						const termWidth =
							tui.terminal?.columns || process.stdout?.columns || 80;
						const sidebarStartCol = Math.max(1, termWidth - active.width + 1);

						if (cx >= sidebarStartCol && cx <= termWidth) {
							if (cb === 64 || cb === 96) {
								scrollSidebar(-3);
								return { consume: true };
							}
							if (cb === 65 || cb === 97) {
								scrollSidebar(3);
								return { consume: true };
							}
						}
					}
				}

				return undefined;
			});
		}

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
		const newWidth = Math.max(16, Math.min(60, current.width + delta));
		const next: SidebarConfig = { ...current, width: newWidth, enabled: true };
		setActiveConfig(next);
		pi.appendEntry(CONFIG_ENTRY_TYPE, next);
		if (currentTui && currentTheme) {
			applySidebar(currentTui, ctx, currentTheme, next);
		}
		ctx.ui.notify(`Šířka postranního panelu: ${newWidth} sloupců`, "info");
	}

	function scrollSidebar(delta: number): void {
		if (sidebarComponent && currentTui) {
			sidebarComponent.scrollBy(delta);
			currentTui.requestRender();
		}
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
		if (removeInputListener) {
			removeInputListener();
			removeInputListener = null;
		}
		unsubBranch?.();
		unsubBranch = null;
		sidebarComponent = null;
		currentTui = null;
	});

	// 4. Keyboard shortcuts for collapsing, resizing, and vertical scrolling
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

	pi.registerShortcut("ctrl+shift+up", {
		description: "Posunout postranní panel nahoru (-3 řádky)",
		handler: () => {
			scrollSidebar(-3);
		},
	});

	pi.registerShortcut("ctrl+shift+down", {
		description: "Posunout postranní panel dolů (+3 řádky)",
		handler: () => {
			scrollSidebar(3);
		},
	});

	pi.registerShortcut("ctrl+shift+u", {
		description: "Posunout postranní panel nahoru (-3 řádky)",
		handler: () => {
			scrollSidebar(-3);
		},
	});

	pi.registerShortcut("ctrl+shift+d", {
		description: "Posunout postranní panel dolů (+3 řádky)",
		handler: () => {
			scrollSidebar(3);
		},
	});

	pi.registerShortcut("ctrl+shift+pageUp", {
		description: "Posunout postranní panel o stránku nahoru (-10 řádků)",
		handler: () => {
			scrollSidebar(-10);
		},
	});

	pi.registerShortcut("ctrl+shift+pageDown", {
		description: "Posunout postranní panel o stránku dolů (+10 řádků)",
		handler: () => {
			scrollSidebar(10);
		},
	});

	// 5. Slash command controller
	registerSidebarCommands(
		pi,
		(newConfig, ctx) => {
			if (currentTui && currentTheme) {
				applySidebar(currentTui, ctx, currentTheme, newConfig);
			}
		},
		(delta) => {
			scrollSidebar(delta);
		},
		(offset) => {
			if (sidebarComponent && currentTui) {
				sidebarComponent.scrollTo(offset);
				currentTui.requestRender();
			}
		},
	);
}
