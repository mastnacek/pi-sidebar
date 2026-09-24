import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
	CONFIG_ENTRY_TYPE,
	DEFAULT_CONFIG,
	getActiveConfig,
	saveConfig,
	setActiveConfig,
} from "./config.js";
import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from "./pane/herdr.js";
import { refreshKimiQuota, refreshZaiQuota } from "./quota.js";
import { nextTab } from "./tabs.js";
import type { SidebarConfig } from "./types.js";

const COMMAND_DOCS: Record<string, string> = {
	on: "otevřít herdr pane postranního panelu",
	off: "zavřít herdr pane postranního panelu",
	toggle: "přepnout herdr pane",
	width: `nastavit přesnou šířku pane ve sloupcích (${MIN_PANE_WIDTH}-${MAX_PANE_WIDTH})`,
	wider: "zvětšit šířku pane (+4 sloupce)",
	narrower: "zmenšit šířku pane (-4 sloupce)",
	tab: "přepnout záložku pane (status | skills | next | prev)",
	refresh: "vynutit obnovení kvót poskytovatelů (Kimi & Z.ai)",
	status: "zobrazit aktuální stav pane",
	reset: "obnovit výchozí nastavení",
	help: "zobrazit přehled příkazů a nápovědu",
};

/** Subcommands that accept a further argument (Trailing Space Contract). */
const NON_TERMINAL = new Set(["width", "tab"]);

/**
 * UI-safe notify: falls back to stdout when running headless (AGENTS.md §6).
 * Command handling must never crash a non-TUI session just because it reports.
 */
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

export function registerSidebarCommands(
	pi: ExtensionAPI,
	onConfigChanged: (config: SidebarConfig, ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("sidebar", {
		description: "Správa herdr pane panelu (šířka, záložka, kvóty)",
		getArgumentCompletions: async (
			prefix: string,
		): Promise<AutocompleteItem[] | null> => {
			const trimmed = prefix.trimStart();

			const getCompletionsClean = async (
				cleanPrefix: string,
			): Promise<AutocompleteItem[] | null> => {
				const tokens = cleanPrefix.split(/\s+/).filter(Boolean);
				const trailingSpace = /\s$/.test(cleanPrefix);
				const normalizedPrefix = tokens.join(" ").toLowerCase();

				const cfgNow = getActiveConfig();
				const mark = (active: boolean, text: string): string =>
					active ? `${text} · ● AKTIVNÍ` : text;

				// 2nd-level completions
				if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
					const cmd = (tokens[0] ?? "").toLowerCase();

					if (cmd === "width") {
						return null;
					}

					if (cmd === "tab") {
						const tabs = [
							{
								value: "tab status",
								label: `tab status${cfgNow.tab === "status" ? " ✓" : ""}`,
								description: mark(
									cfgNow.tab === "status",
									"Telemetrie: kontext, cena, tokeny, model, git",
								),
							},
							{
								value: "tab skills",
								label: `tab skills${cfgNow.tab === "skills" ? " ✓" : ""}`,
								description: mark(
									cfgNow.tab === "skills",
									"Skill HUD z pi-plugin-dev (reference, focus, compliance)",
								),
							},
							{
								value: "tab next",
								label: "tab next",
								description: "Přepnout na další záložku",
							},
							{
								value: "tab prev",
								label: "tab prev",
								description: "Přepnout na předchozí záložku",
							},
						];
						const filtered = tabs.filter((i) =>
							i.value.toLowerCase().startsWith(normalizedPrefix),
						);
						return filtered.length > 0 ? filtered : null;
					}

					return null;
				}

				// 1st-level completions
				const typed = (tokens[0] ?? "").toLowerCase();
				const items: AutocompleteItem[] = [];

				if ("--global".startsWith(typed)) {
					items.push({
						value: "--global ",
						label: "--global",
						description: "Uložit následující nastavení globálně (~/.pi/agent/)",
					});
				}

				for (const [key, description] of Object.entries(COMMAND_DOCS)) {
					if (!key.toLowerCase().startsWith(typed)) continue;
					const flag =
						key === "on" ? cfgNow.enabled : key === "off" ? !cfgNow.enabled : undefined;
					const state =
						flag === undefined ? "" : flag ? " · ● ZAPNUTO" : " · ○ VYPNUTO";
					items.push({
						value: NON_TERMINAL.has(key) ? `${key} ` : key,
						label: key,
						description: `${description}${state}`,
					});
				}

				return items.length > 0 ? items : null;
			};

			if (trimmed.startsWith("--global")) {
				const afterGlobal = trimmed.slice(8).trimStart();
				const hasTrailingSpace = trimmed.length > 8 || /\s$/.test(prefix);

				if (!hasTrailingSpace && afterGlobal === "") {
					return [
						{
							value: "--global ",
							label: "--global",
							description: "Uložit následující nastavení globálně (~/.pi/agent/)",
						},
					];
				}

				const subCompletions = await getCompletionsClean(afterGlobal);
				if (!subCompletions) return null;

				return subCompletions
					.filter((item) => item.label !== "--global")
					.map((item) => ({
						value: `--global ${item.value}`,
						label: item.label,
						description: item.description,
					}));
			}

			return getCompletionsClean(trimmed);
		},

		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
			const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");

			const subcommand = (cleanTokens[0] ?? "").toLowerCase();
			const rest = cleanTokens.slice(1);
			const value = rest.join(" ").trim();

			if (
				!subcommand ||
				subcommand === "help" ||
				subcommand === "-h" ||
				subcommand === "--help"
			) {
				const cfg = getActiveConfig();
				const helpText = [
					"# /sidebar — herdr pane postranního panelu",
					"Panel je vykreslován výhradně v samostatném herdr pane (mimo okno Pi).",
					"",
					"### Příkazy:",
					"  /sidebar on|off|toggle   — Otevřít / zavřít / přepnout pane",
					"  /sidebar width <N>       — Šířka pane ve sloupcích",
					"  /sidebar wider|narrower  — Šířka pane ±4 sloupce",
					"  /sidebar tab <záložka>   — status | skills | next | prev",
					"  /sidebar refresh         — Obnovit kvóty Kimi a Z.ai",
					"  /sidebar status          — Aktuální stav",
					"  /sidebar reset           — Výchozí nastavení",
					"  /sidebar help            — Tato nápověda",
					"",
					"### Aktuální stav:",
					`  • Panel: ${cfg.enabled ? "otevřený" : "zavřený"}`,
					`  • Šířka pane: ${cfg.paneWidth} sloupců`,
					`  • Záložka: ${cfg.tab} | Relace: ${cfg.showSession ? "ZAP" : "VYP"} | Git: ${cfg.showGit ? "ZAP" : "VYP"}`,
					"",
					"Tip: Přidejte `--global` pro trvalé uložení do ~/.pi/agent/pi-sidebar.json.",
				].join("\n");
				notify(ctx, helpText, "info");
				return;
			}

			const current = getActiveConfig();
			let nextConfig: SidebarConfig = { ...current };

			const clampWidth = (raw: number): number =>
				Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, raw));

			switch (subcommand) {
				case "on":
					nextConfig.enabled = true;
					notify(ctx, `Panel otevřen (${nextConfig.paneWidth} sloupců)`, "info");
					break;

				case "off":
					nextConfig.enabled = false;
					notify(ctx, "Panel zavřen", "info");
					break;

				case "toggle":
					nextConfig.enabled = !current.enabled;
					notify(
						ctx,
						`Panel ${nextConfig.enabled ? "otevřen" : "zavřen"}`,
						"info",
					);
					break;

				case "width": {
					const num = Number.parseInt(value, 10);
					if (
						Number.isNaN(num) ||
						num < MIN_PANE_WIDTH ||
						num > MAX_PANE_WIDTH
					) {
						notify(
							ctx,
							`Šířka musí být číslo v rozmezí ${MIN_PANE_WIDTH} až ${MAX_PANE_WIDTH} sloupců (např. /sidebar width 60).`,
							"warning",
						);
						return;
					}
					nextConfig.paneWidth = num;
					notify(ctx, `Šířka pane: ${num} sloupců`, "info");
					break;
				}

				case "wider": {
					const delta = Number.parseInt(value, 10) || 4;
					const next = clampWidth(current.paneWidth + Math.abs(delta));
					nextConfig.paneWidth = next;
					notify(
						ctx,
						`Šířka pane: ${next} sloupců (+${next - current.paneWidth})`,
						"info",
					);
					break;
				}

				case "narrower": {
					const delta = Number.parseInt(value, 10) || 4;
					const next = clampWidth(current.paneWidth - Math.abs(delta));
					nextConfig.paneWidth = next;
					notify(
						ctx,
						`Šířka pane: ${next} sloupců (-${current.paneWidth - next})`,
						"info",
					);
					break;
				}

				case "tab": {
					const requested = value.toLowerCase();
					if (requested === "next" || requested === "prev") {
						nextConfig.tab = nextTab(current.tab, requested === "next" ? 1 : -1);
					} else if (requested === "status" || requested === "skills") {
						nextConfig.tab = requested;
					} else if (!requested) {
						nextConfig.tab = nextTab(current.tab, 1);
					} else {
						notify(
							ctx,
							"Neplatná záložka. Vyberte: status, skills, next nebo prev",
							"warning",
						);
						return;
					}
					notify(
						ctx,
						`Záložka panelu: ${nextConfig.tab === "skills" ? "Skills (pi-plugin-dev)" : "Status"}`,
						"info",
					);
					break;
				}

				case "refresh": {
					notify(ctx, "Obnovuji kvóty poskytovatelů...", "info");
					void refreshKimiQuota(true, () => onConfigChanged(current, ctx));
					void refreshZaiQuota(true, () => onConfigChanged(current, ctx));
					return;
				}

				case "status": {
					const msg = [
						`Panel: ${current.enabled ? "OTEVŘEN" : "ZAVŘEN"}`,
						`Šířka: ${current.paneWidth} sloupců`,
						`Záložka: ${current.tab}`,
						`Relace: ${current.showSession ? "ZAP" : "VYP"} | Git: ${current.showGit ? "ZAP" : "VYP"}`,
						`Keep-alive: ${current.paneKeepAlive ? "ZAP" : "VYP"}`,
					].join(" | ");
					notify(ctx, msg, "info");
					return;
				}

				case "reset":
					nextConfig = { ...DEFAULT_CONFIG };
					notify(ctx, "Nastavení panelu obnoveno na výchozí hodnoty", "info");
					break;

				default:
					notify(
						ctx,
						`Neznámý příkaz "${subcommand}". Použijte: /sidebar help`,
						"warning",
					);
					return;
			}

			setActiveConfig(nextConfig);

			saveConfig(nextConfig, isGlobal, ctx.cwd);

			// Persist in the current session log (TUI/session state, never LLM context).
			pi.appendEntry(CONFIG_ENTRY_TYPE, nextConfig);

			// Trigger refresh in the caller.
			onConfigChanged(nextConfig, ctx);
		},
	});
}
