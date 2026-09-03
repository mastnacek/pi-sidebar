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
	saveGlobalConfig,
	setActiveConfig,
} from "./config.js";
import { refreshKimiQuota, refreshZaiQuota } from "./quota.js";
import type {
	SidebarBorderStyle,
	SidebarBranding,
	SidebarConfig,
	SidebarPreset,
} from "./types.js";

const COMMAND_DOCS: Record<string, string> = {
	on: "rozbalit / zapnout postranní panel (sidebar overlay)",
	off: "sbalit / vypnout postranní panel (sidebar overlay)",
	toggle: "přepnout sbalení / rozbalení panelu (ctrl+shift+b)",
	collapse: "sbalit postranní panel («)",
	expand: "rozbalit postranní panel",
	wider: "zvětšit šířku panelu (+4 sloupce, ctrl+shift+→)",
	narrower: "zmenšit šířku panelu (-4 sloupce, ctrl+shift+←)",
	mcp: "přepnout zobrazení MCP serverů v panelu (on | off | toggle)",
	lsp: "přepnout zobrazení LSP stavu v panelu (on | off | toggle)",
	extensions: "přepnout zobrazení rozšíření v panelu (on | off | toggle)",
	width: "nastavit přesnou šířku panelu v sloupcích (8-60)",
	resize: "upravit šířku panelu (+N nebo -N)",
	preset: "přepnout styl zobrazení (opencode | compact | detailed | minimal)",
	refresh: "vynutit aktualizaci kvót poskytovatelů (Kimi & Z.ai)",
	branding: "přepnout text patičky (opencode | pi | custom)",
	border:
		"nastavit styl oddělovacího rámečku (line | double | dotted | space | none)",
	status: "zobrazit aktuální konfiguraci a stav panelu",
	reset: "obnovit výchozí nastavení panelu",
	help: "zobrazit přehled příkazů a nápovědu",
};

export function registerSidebarCommands(
	pi: ExtensionAPI,
	onConfigChanged: (config: SidebarConfig, ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("sidebar", {
		description: "Správa a nastavení rozbalovacího postranního panelu (sidebar)",
		getArgumentCompletions: async (
			prefix: string,
		): Promise<AutocompleteItem[] | null> => {
			const tokens = prefix.split(/\s+/).filter(Boolean);
			const trailingSpace = /\s$/.test(prefix);
			const normalizedPrefix = tokens.join(" ").toLowerCase();

			// 2nd-level completions
			if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
				const cmd = (tokens[0] ?? "").toLowerCase();

				if (
					[
						"on",
						"off",
						"toggle",
						"collapse",
						"expand",
						"wider",
						"narrower",
						"status",
						"refresh",
						"reset",
						"help",
					].includes(cmd)
				) {
					return null;
				}

				if (
					cmd === "extensions" ||
					cmd === "statusline" ||
					cmd === "mcp" ||
					cmd === "lsp"
				) {
					const extOptions = [
						{
							value: `${cmd} on`,
							label: `${cmd} on`,
							description: `Zapnout sekci ${cmd.toUpperCase()} v postranním panelu`,
						},
						{
							value: `${cmd} off`,
							label: `${cmd} off`,
							description: `Skrýt sekci ${cmd.toUpperCase()} z postranního panelu`,
						},
						{
							value: `${cmd} toggle`,
							label: `${cmd} toggle`,
							description: `Přepnout sekci ${cmd.toUpperCase()} v panelu`,
						},
					];
					const filtered = extOptions.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				if (cmd === "width" || cmd === "resize") {
					const widths = [
						{
							value: `${cmd} 10`,
							label: `${cmd} 10`,
							description: "Minimální pruh (10 sloupců, preset minimal)",
						},
						{
							value: `${cmd} 24`,
							label: `${cmd} 24`,
							description: "Kompaktní šířka (24 sloupců)",
						},
						{
							value: `${cmd} 28`,
							label: `${cmd} 28`,
							description: "Výchozí šířka (28 sloupců)",
						},
						{
							value: `${cmd} 32`,
							label: `${cmd} 32`,
							description: "Standardní šířka (32 sloupců)",
						},
						{
							value: `${cmd} 36`,
							label: `${cmd} 36`,
							description: "Široký panel (36 sloupců)",
						},
					];
					const filtered = widths.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				if (cmd === "preset") {
					const presets = [
						{
							value: "preset opencode",
							label: "preset opencode",
							description: "Klasické OpenCode rozložení panelu",
						},
						{
							value: "preset compact",
							label: "preset compact",
							description: "Minimální kompaktní vertikální linka",
						},
						{
							value: "preset detailed",
							label: "preset detailed",
							description: "Kompletní telemetrie, kvóty a kontextový pruh",
						},
						{
							value: "preset minimal",
							label: "preset minimal",
							description: "Úzký pruh ukazatelů — kruhový kontextový graf a tečky",
						},
					];
					const filtered = presets.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				if (cmd === "branding") {
					const brandings = [
						{
							value: "branding opencode",
							label: "branding opencode",
							description: "• OpenCode 1.18.26",
						},
						{
							value: "branding pi",
							label: "branding pi",
							description: "• Pi Agent v0.84.4",
						},
						{
							value: "branding custom",
							label: "branding custom",
							description: "Vlastní text v patičce",
						},
					];
					const filtered = brandings.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				if (cmd === "border") {
					const borders = [
						{
							value: "border line",
							label: "border line",
							description: "Jednoduchá svislá čára (│)",
						},
						{
							value: "border double",
							label: "border double",
							description: "Dvojitá svislá čára (║)",
						},
						{
							value: "border dotted",
							label: "border dotted",
							description: "Tečkovaná svislá čára (┆)",
						},
						{
							value: "border space",
							label: "border space",
							description: "Oddělení mezerou",
						},
						{
							value: "border none",
							label: "border none",
							description: "Bez oddělovače",
						},
					];
					const filtered = borders.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				return null;
			}

			// 1st-level completions
			const typed = (tokens[0] ?? "").toLowerCase();
			const items = Object.entries(COMMAND_DOCS)
				.filter(([key]) => key.toLowerCase().startsWith(typed))
				.map(([value, description]) => ({ value, label: value, description }));

			return items.length > 0 ? items : null;
		},

		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
			const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");

			const subcommand = (cleanTokens[0] ?? "").toLowerCase();
			const rest = cleanTokens.slice(1);
			const value = rest.join(" ").trim();

			// Help reference display
			if (
				!subcommand ||
				subcommand === "help" ||
				subcommand === "-h" ||
				subcommand === "--help"
			) {
				const cfg = getActiveConfig();
				const helpText = [
					"# /sidebar — Správce rozbalovacího postranního panelu",
					"Ukotvený pravý postranní panel s dynamickou změnou šířky a telemetrií.",
					"",
					"### Klávesové zkratky a ovládání:",
					"  ctrl+shift+b               — Přepnout minimal pruh / předchozí styl",
					"  ctrl+shift+→/←             — Zvětšit / zmenšit šířku panelu (±4 sloupce)",
					"",
					"### Trvalá nápověda zkratek:",
					"  Zkratkový tahák je trvale zobrazen ve spodní části postranního panelu.",
					"",
					"### Význam ukazatelů v minimal pruhu (preset minimal / ctrl+shift+b):",
					"  ⭕ kruhový graf + %  — využití kontextu (zelená OK, žlutá ≥80 %, červená ≥90 %)",
					"  💰 $x.xx            — útrata relace",
					"  🧠 ⚡ 🔥 💤 …        — aktuální úroveň thinking",
					"  📶 NN %             — horší z kvót poskytovatele (týden / 5h okno)",
					"  🌿 ● / 🌿 ○         — git: ● změny, ○ čistý pracovní adresář",
					"  ↑N / ↓N             — git: o N commitů napřed / pozadu",
					"  🔌 ● / 🔌 ○         — MCP nástroje: ● aktivní, ○ neaktivní",
					"  💡 ● / 💡 ○         — LSP servery: ● aktivní, ○ neaktivní",
					"",
					"### Příkazy:",
					"  /sidebar on|off|toggle     — Zapnout / vypnout / přepnout panel",
					"  /sidebar collapse|expand   — Explicitně sbalit nebo rozbalit",
					"  /sidebar mcp on|off        — Zobrazit/skrýt sekci MCP serverů v panelu",
					"  /sidebar lsp on|off        — Zobrazit/skrýt sekci LSP stavu v panelu",
					"  /sidebar extensions on|off — Zobrazit/skrýt ostatní rozšíření v panelu",
					"  /sidebar wider [delta]     — Zvětšit šířku panelu (výchozí: +4)",
					"  /sidebar narrower [delta]  — Zmenšit šířku panelu (výchozí: -4)",
					"  /sidebar width <8-60>      — Nastavit přesnou šířku panelu (výchozí: 28, minimal pruh: 10)",
					"  /sidebar preset <název>    — Přepnout styl (opencode | compact | detailed | minimal)",
					"  /sidebar refresh           — Vynutit obnovení kvót Kimi a Z.ai",
					"  /sidebar branding <typ>    — Styl patičky (opencode | pi | custom <text>)",
					"  /sidebar border <styl>     — Styl oddělovače (line | double | dotted | space | none)",
					"  /sidebar reset             — Obnovit výchozí nastavení",
					"  /sidebar help              — Zobrazit tuto nápovědu",
					"",
					"### Aktuální stav:",
					`  • Stav: ${cfg.enabled ? "Rozbaleno" : "Sbaleno («)"}`,
					`  • Šířka: ${cfg.width} sloupců (min. šířka terminálu: ${cfg.minTerminalWidth} sloupců)`,
					`  • Styl: ${cfg.preset} | Rozšíření v panelu: ${cfg.showExtensions ? "ZAPNUTO" : "VYPNUTO"}`,
					`  • Patička: ${cfg.branding} | Rámeček: ${cfg.borderStyle}`,
					"",
					"Tip: Přidejte `--global` pro trvalé uložení do ~/.pi/agent/pi-sidebar.json pro všechny budoucí relace.",
				].join("\n");

				ctx.ui.notify(helpText, "info");
				return;
			}

			const current = getActiveConfig();
			let nextConfig: SidebarConfig = { ...current };

			switch (subcommand) {
				case "on":
				case "expand":
					nextConfig.enabled = true;
					ctx.ui.notify(
						`Postranní panel rozbalen (${nextConfig.width} sloupců)`,
						"info",
					);
					break;

				case "off":
				case "collapse":
					nextConfig.enabled = false;
					ctx.ui.notify("Postranní panel sbalen («)", "info");
					break;

				case "toggle":
					nextConfig.enabled = !current.enabled;
					ctx.ui.notify(
						`Postranní panel ${nextConfig.enabled ? `rozbalen (${nextConfig.width} sloupců)` : "sbalen («)"}`,
						"info",
					);
					break;

				case "mcp": {
					const val = value.toLowerCase();
					if (val === "on" || val === "true" || val === "show") {
						nextConfig.showMcp = true;
						ctx.ui.notify("Sekce MCP v panelu: ZAPNUTO", "info");
					} else if (val === "off" || val === "false" || val === "hide") {
						nextConfig.showMcp = false;
						ctx.ui.notify("Sekce MCP v panelu: VYPNUTO", "info");
					} else {
						nextConfig.showMcp = !current.showMcp;
						ctx.ui.notify(
							`Sekce MCP v panelu: ${nextConfig.showMcp ? "ZAPNUTO" : "VYPNUTO"}`,
							"info",
						);
					}
					break;
				}

				case "lsp": {
					const val = value.toLowerCase();
					if (val === "on" || val === "true" || val === "show") {
						nextConfig.showLsp = true;
						ctx.ui.notify("Sekce LSP v panelu: ZAPNUTO", "info");
					} else if (val === "off" || val === "false" || val === "hide") {
						nextConfig.showLsp = false;
						ctx.ui.notify("Sekce LSP v panelu: VYPNUTO", "info");
					} else {
						nextConfig.showLsp = !current.showLsp;
						ctx.ui.notify(
							`Sekce LSP v panelu: ${nextConfig.showLsp ? "ZAPNUTO" : "VYPNUTO"}`,
							"info",
						);
					}
					break;
				}

				case "extensions":
				case "statusline": {
					const val = value.toLowerCase();
					if (val === "on" || val === "true" || val === "show") {
						nextConfig.showExtensions = true;
						ctx.ui.notify("Zobrazení rozšíření v panelu: ZAPNUTO", "info");
					} else if (val === "off" || val === "false" || val === "hide") {
						nextConfig.showExtensions = false;
						ctx.ui.notify("Zobrazení rozšíření v panelu: VYPNUTO", "info");
					} else {
						nextConfig.showExtensions = !current.showExtensions;
						ctx.ui.notify(
							`Zobrazení rozšíření v panelu: ${nextConfig.showExtensions ? "ZAPNUTO" : "VYPNUTO"}`,
							"info",
						);
					}
					break;
				}

				case "status": {
					const msg = [
						`Postranní panel: ${current.enabled ? "ROZBALENO" : "SBALENO («)"}`,
						`Šířka: ${current.width} sloupců | Min. šířka terminálu: ${current.minTerminalWidth}`,
						`Styl: ${current.preset} | Rozšíření: ${current.showExtensions ? "ZAPNUTO" : "VYPNUTO"}`,
						`Patička: ${current.branding} | Rámeček: ${current.borderStyle}`,
					].join(" | ");
					ctx.ui.notify(msg, "info");
					return;
				}

				case "wider": {
					const delta = Number.parseInt(value, 10) || 4;
					const newW = Math.min(60, current.width + Math.abs(delta));
					nextConfig.width = newW;
					nextConfig.enabled = true;
					ctx.ui.notify(
						`Šířka panelu: ${newW} sloupců (+${newW - current.width})`,
						"info",
					);
					break;
				}

				case "narrower": {
					const delta = Number.parseInt(value, 10) || 4;
					const newW = Math.max(16, current.width - Math.abs(delta));
					nextConfig.width = newW;
					nextConfig.enabled = true;
					ctx.ui.notify(
						`Šířka panelu: ${newW} sloupců (-${current.width - newW})`,
						"info",
					);
					break;
				}

				case "resize": {
					if (value.startsWith("+") || value.startsWith("-")) {
						const delta = Number.parseInt(value, 10);
						if (!Number.isNaN(delta)) {
							const newW = Math.max(8, Math.min(60, current.width + delta));
							nextConfig.width = newW;
							nextConfig.enabled = true;
							ctx.ui.notify(`Šířka panelu: ${newW} sloupců`, "info");
							break;
						}
					}
					const num = Number.parseInt(value, 10);
					if (Number.isNaN(num) || num < 8 || num > 60) {
						ctx.ui.notify(
							"Šířka musí být v rozmezí 8 až 60 sloupců (např. /sidebar resize +4 nebo /sidebar resize 32).",
							"warning",
						);
						return;
					}
					nextConfig.width = num;
					nextConfig.enabled = true;
					ctx.ui.notify(`Šířka panelu: ${num} sloupců`, "info");
					break;
				}

				case "refresh": {
					ctx.ui.notify("Obnovuji kvóty poskytovatelů...", "info");
					void refreshKimiQuota(true, () => onConfigChanged(current, ctx));
					void refreshZaiQuota(true, () => onConfigChanged(current, ctx));
					return;
				}

				case "width": {
					const num = Number.parseInt(value, 10);
					if (Number.isNaN(num) || num < 8 || num > 60) {
						ctx.ui.notify(
							"Šířka musí být číslo v rozmezí 8 až 60 sloupců (např. /sidebar width 28).",
							"warning",
						);
						return;
					}
					nextConfig.width = num;
					nextConfig.enabled = true;
					ctx.ui.notify(`Šířka panelu nastavena na ${num} sloupců`, "info");
					break;
				}

				case "preset": {
					const p = value.toLowerCase() as SidebarPreset;
					if (!["opencode", "compact", "detailed", "minimal"].includes(p)) {
						ctx.ui.notify(
							"Neplatný styl. Vyberte: opencode, compact, detailed nebo minimal",
							"warning",
						);
						return;
					}
					nextConfig.preset = p;
					// Minimal gauge strip needs a narrow width; other presets need room.
					if (p === "minimal" && nextConfig.width > 12) {
						nextConfig.width = 10;
					} else if (p !== "minimal" && nextConfig.width < 16) {
						nextConfig.width = 28;
					}
					ctx.ui.notify(
						`Styl postranního panelu nastaven na "${p}" (šířka ${nextConfig.width} sloupců)`,
						"info",
					);
					break;
				}

				case "branding": {
					const parts = value.split(/\s+/);
					const brandType = (parts[0] ?? "").toLowerCase() as SidebarBranding;
					if (!["opencode", "pi", "custom"].includes(brandType)) {
						ctx.ui.notify(
							"Neplatný typ patičky. Vyberte: opencode, pi nebo custom <text>",
							"warning",
						);
						return;
					}
					nextConfig.branding = brandType;
					if (brandType === "custom" && parts.length > 1) {
						nextConfig.customBrandingText = parts.slice(1).join(" ");
					}
					ctx.ui.notify(`Patička panelu nastavena na "${brandType}"`, "info");
					break;
				}

				case "border": {
					const b = value.toLowerCase() as SidebarBorderStyle;
					if (!["line", "double", "dotted", "space", "none"].includes(b)) {
						ctx.ui.notify(
							"Neplatný styl oddělovače. Vyberte: line, double, dotted, space, none",
							"warning",
						);
						return;
					}
					nextConfig.borderStyle = b;
					ctx.ui.notify(`Styl oddělovače nastaven na "${b}"`, "info");
					break;
				}

				case "reset":
					nextConfig = { ...DEFAULT_CONFIG };
					ctx.ui.notify(
						"Nastavení postranního panelu bylo obnoveno na výchozí hodnoty",
						"info",
					);
					break;

				default:
					ctx.ui.notify(
						`Neznámý příkaz "${subcommand}". Použijte: /sidebar help`,
						"warning",
					);
					return;
			}

			setActiveConfig(nextConfig);

			if (isGlobal) {
				saveGlobalConfig(nextConfig);
			}

			// Persist in current session log
			pi.appendEntry(CONFIG_ENTRY_TYPE, nextConfig);

			// Trigger refresh in caller
			onConfigChanged(nextConfig, ctx);
		},
	});
}
