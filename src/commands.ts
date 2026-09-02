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
	on: "enable sidebar overlay",
	off: "disable sidebar overlay",
	toggle: "toggle sidebar visibility",
	status: "display current sidebar configuration and metrics",
	width: "set sidebar column width (16-60)",
	preset: "switch content preset (opencode | compact | detailed)",
	footer: "toggle bottom footer visibility (hide | show)",
	refresh: "refresh provider quota meters (Kimi & Z.ai)",
	branding: "switch branding text (opencode | pi | custom)",
	border: "set border style (line | double | dotted | space | none)",
	reset: "reset sidebar settings to defaults",
	help: "display detailed help reference banner",
};

export function registerSidebarCommands(
	pi: ExtensionAPI,
	onConfigChanged: (config: SidebarConfig, ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("sidebar", {
		description: "OpenCode-style sidebar overlay controller",
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
					["on", "off", "toggle", "status", "refresh", "reset", "help"].includes(
						cmd,
					)
				) {
					return null;
				}

				if (cmd === "width") {
					const widths = [
						{
							value: "width 24",
							label: "width 24",
							description: "Compact width (24 cols)",
						},
						{
							value: "width 28",
							label: "width 28",
							description: "Default OpenCode width (28 cols)",
						},
						{
							value: "width 32",
							label: "width 32",
							description: "Standard width (32 cols)",
						},
						{
							value: "width 36",
							label: "width 36",
							description: "Spacious width (36 cols)",
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
							description: "Classic OpenCode sidebar layout",
						},
						{
							value: "preset compact",
							label: "preset compact",
							description: "Minimal compact vertical layout",
						},
						{
							value: "preset detailed",
							label: "preset detailed",
							description: "Full dashboard with status lines in sidebar",
						},
					];
					const filtered = presets.filter((i) =>
						i.value.toLowerCase().startsWith(normalizedPrefix),
					);
					return filtered.length > 0 ? filtered : null;
				}

				if (cmd === "footer") {
					const footers = [
						{
							value: "footer hide",
							label: "footer hide",
							description: "Hide bottom footer (move all status to sidebar)",
						},
						{
							value: "footer show",
							label: "footer show",
							description: "Show bottom footer alongside sidebar",
						},
					];
					const filtered = footers.filter((i) =>
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
							description: "Custom brand text",
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
							description: "Single vertical line (│)",
						},
						{
							value: "border double",
							label: "border double",
							description: "Double vertical line (║)",
						},
						{
							value: "border dotted",
							label: "border dotted",
							description: "Dotted line (┆)",
						},
						{
							value: "border space",
							label: "border space",
							description: "Space separator",
						},
						{
							value: "border none",
							label: "border none",
							description: "No border separator",
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
					"# /sidebar — OpenCode & Detailed Sidebar Reference",
					"Right-hand sidebar overlay with OpenCode, Compact, and Detailed presets.",
					"",
					"### Commands:",
					"  /sidebar on|off|toggle     — Toggle sidebar visibility",
					"  /sidebar status            — Show active configuration & metrics",
					"  /sidebar preset <name>     — Switch preset (opencode | compact | detailed)",
					"  /sidebar footer <hide|show>— Control bottom footer visibility",
					"  /sidebar refresh           — Force refresh Kimi and Z.ai quotas",
					"  /sidebar width <16-60>     — Adjust column width (default: 28)",
					"  /sidebar branding <type>   — Switch footer branding (opencode | pi | custom <text>)",
					"  /sidebar border <style>    — Set border style (line | double | dotted | space | none)",
					"  /sidebar reset             — Reset to defaults",
					"  /sidebar help              — Show this help banner",
					"",
					"### Current State:",
					`  • Status: ${cfg.enabled ? "Enabled" : "Disabled"}`,
					`  • Width: ${cfg.width} cols (min terminal: ${cfg.minTerminalWidth} cols)`,
					`  • Preset: ${cfg.preset} | Branding: ${cfg.branding} | Border: ${cfg.borderStyle}`,
					`  • Bottom Footer: ${cfg.hideBottomFooter ? "Hidden (moved to sidebar)" : "Visible"}`,
					"",
					"Tip: Append `--global` to persist setting across all future sessions.",
				].join("\n");

				ctx.ui.notify(helpText, "info");
				return;
			}

			const current = getActiveConfig();
			let nextConfig: SidebarConfig = { ...current };

			switch (subcommand) {
				case "on":
					nextConfig.enabled = true;
					ctx.ui.notify("Sidebar overlay enabled", "info");
					break;

				case "off":
					nextConfig.enabled = false;
					ctx.ui.notify("Sidebar overlay disabled", "info");
					break;

				case "toggle":
					nextConfig.enabled = !current.enabled;
					ctx.ui.notify(
						`Sidebar overlay ${nextConfig.enabled ? "enabled" : "disabled"}`,
						"info",
					);
					break;

				case "status": {
					const msg = [
						`Sidebar: ${current.enabled ? "ENABLED" : "DISABLED"}`,
						`Width: ${current.width} cols | Min Term Width: ${current.minTerminalWidth}`,
						`Preset: ${current.preset} | Branding: ${current.branding} | Border: ${current.borderStyle}`,
						`Bottom Footer: ${current.hideBottomFooter ? "Hidden" : "Visible"}`,
					].join(" | ");
					ctx.ui.notify(msg, "info");
					return;
				}

				case "footer": {
					const f = value.toLowerCase();
					if (f === "hide" || f === "off") {
						nextConfig.hideBottomFooter = true;
						ctx.ui.notify(
							"Bottom footer hidden (status line moved to sidebar)",
							"info",
						);
					} else if (f === "show" || f === "on") {
						nextConfig.hideBottomFooter = false;
						ctx.ui.notify("Bottom footer restored", "info");
					} else {
						ctx.ui.notify(
							"Invalid option. Use: /sidebar footer hide or /sidebar footer show",
							"warning",
						);
						return;
					}
					break;
				}

				case "refresh": {
					ctx.ui.notify("Refreshing provider quotas...", "info");
					void refreshKimiQuota(true, () => onConfigChanged(current, ctx));
					void refreshZaiQuota(true, () => onConfigChanged(current, ctx));
					return;
				}

				case "width": {
					const num = Number.parseInt(value, 10);
					if (Number.isNaN(num) || num < 16 || num > 60) {
						ctx.ui.notify(
							"Width must be a number between 16 and 60 columns. (e.g. /sidebar width 28)",
							"warning",
						);
						return;
					}
					nextConfig.width = num;
					ctx.ui.notify(`Sidebar width set to ${num} columns`, "info");
					break;
				}

				case "preset": {
					const p = value.toLowerCase() as SidebarPreset;
					if (!["opencode", "compact", "detailed"].includes(p)) {
						ctx.ui.notify(
							"Invalid preset. Choose: opencode, compact, or detailed",
							"warning",
						);
						return;
					}
					nextConfig.preset = p;
					ctx.ui.notify(`Sidebar preset set to "${p}"`, "info");
					break;
				}

				case "branding": {
					const parts = value.split(/\s+/);
					const brandType = (parts[0] ?? "").toLowerCase() as SidebarBranding;
					if (!["opencode", "pi", "custom"].includes(brandType)) {
						ctx.ui.notify(
							"Invalid branding. Choose: opencode, pi, or custom <text>",
							"warning",
						);
						return;
					}
					nextConfig.branding = brandType;
					if (brandType === "custom" && parts.length > 1) {
						nextConfig.customBrandingText = parts.slice(1).join(" ");
					}
					ctx.ui.notify(`Sidebar branding set to "${brandType}"`, "info");
					break;
				}

				case "border": {
					const b = value.toLowerCase() as SidebarBorderStyle;
					if (!["line", "double", "dotted", "space", "none"].includes(b)) {
						ctx.ui.notify(
							"Invalid border style. Choose: line, double, dotted, space, none",
							"warning",
						);
						return;
					}
					nextConfig.borderStyle = b;
					ctx.ui.notify(`Sidebar border style set to "${b}"`, "info");
					break;
				}

				case "reset":
					nextConfig = { ...DEFAULT_CONFIG };
					ctx.ui.notify("Sidebar settings reset to defaults", "info");
					break;

				default:
					ctx.ui.notify(
						`Unknown subcommand "${subcommand}". Use: /sidebar help`,
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
