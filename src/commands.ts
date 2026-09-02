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
	on: "expand / enable sidebar overlay",
	off: "collapse / disable sidebar overlay",
	toggle: "toggle collapse / expand sidebar (ctrl+shift+b)",
	collapse: "collapse sidebar overlay",
	expand: "expand sidebar overlay",
	wider: "increase sidebar width (+4 cols, alt+])",
	narrower: "decrease sidebar width (-4 cols, alt+[)",
	width: "set sidebar column width (16-60)",
	resize: "adjust sidebar width (+N or -N)",
	preset: "switch content preset (opencode | compact | detailed)",
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
		description: "Resizable & collapsible sidebar overlay controller",
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

				if (cmd === "width" || cmd === "resize") {
					const widths = [
						{
							value: `${cmd} 24`,
							label: `${cmd} 24`,
							description: "Compact width (24 cols)",
						},
						{
							value: `${cmd} 28`,
							label: `${cmd} 28`,
							description: "Default width (28 cols)",
						},
						{
							value: `${cmd} 32`,
							label: `${cmd} 32`,
							description: "Standard width (32 cols)",
						},
						{
							value: `${cmd} 36`,
							label: `${cmd} 36`,
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
							description: "Full telemetry dashboard in sidebar",
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
					"# /sidebar — Resizable & Collapsible Sidebar Controller",
					"Docked right-hand sidebar with dynamic resizing and quick collapse.",
					"",
					"### Controls & Shortcuts:",
					"  ctrl+shift+b               — Toggle collapse / expand («)",
					"  alt+] / alt+[              — Resize width wider / narrower (±4 cols)",
					"",
					"### Commands:",
					"  /sidebar on|off|toggle     — Toggle collapse / expand",
					"  /sidebar collapse|expand   — Explicit collapse or expand",
					"  /sidebar wider [delta]     — Increase column width (default: +4)",
					"  /sidebar narrower [delta]  — Decrease column width (default: -4)",
					"  /sidebar width <16-60>     — Set exact column width (default: 28)",
					"  /sidebar preset <name>     — Switch preset (opencode | compact | detailed)",
					"  /sidebar refresh           — Force refresh Kimi and Z.ai quotas",
					"  /sidebar branding <type>   — Switch footer branding (opencode | pi | custom <text>)",
					"  /sidebar border <style>    — Set border style (line | double | dotted | space | none)",
					"  /sidebar reset             — Reset to defaults",
					"  /sidebar help              — Show this help banner",
					"",
					"### Current State:",
					`  • Status: ${cfg.enabled ? "Expanded" : "Collapsed («)"}`,
					`  • Width: ${cfg.width} cols (min terminal: ${cfg.minTerminalWidth} cols)`,
					`  • Preset: ${cfg.preset} | Branding: ${cfg.branding} | Border: ${cfg.borderStyle}`,
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
				case "expand":
					nextConfig.enabled = true;
					ctx.ui.notify(`Sidebar expanded (${nextConfig.width} cols)`, "info");
					break;

				case "off":
				case "collapse":
					nextConfig.enabled = false;
					ctx.ui.notify("Sidebar collapsed («)", "info");
					break;

				case "toggle":
					nextConfig.enabled = !current.enabled;
					ctx.ui.notify(
						`Sidebar ${nextConfig.enabled ? `expanded (${nextConfig.width} cols)` : "collapsed («)"}`,
						"info",
					);
					break;

				case "status": {
					const msg = [
						`Sidebar: ${current.enabled ? "EXPANDED" : "COLLAPSED («)"}`,
						`Width: ${current.width} cols | Min Term Width: ${current.minTerminalWidth}`,
						`Preset: ${current.preset} | Branding: ${current.branding} | Border: ${current.borderStyle}`,
					].join(" | ");
					ctx.ui.notify(msg, "info");
					return;
				}

				case "wider": {
					const delta = Number.parseInt(value, 10) || 4;
					const newW = Math.min(60, current.width + Math.abs(delta));
					nextConfig.width = newW;
					nextConfig.enabled = true;
					ctx.ui.notify(`Sidebar width: ${newW} cols (+${newW - current.width})`, "info");
					break;
				}

				case "narrower": {
					const delta = Number.parseInt(value, 10) || 4;
					const newW = Math.max(16, current.width - Math.abs(delta));
					nextConfig.width = newW;
					nextConfig.enabled = true;
					ctx.ui.notify(`Sidebar width: ${newW} cols (-${current.width - newW})`, "info");
					break;
				}

				case "resize": {
					if (value.startsWith("+") || value.startsWith("-")) {
						const delta = Number.parseInt(value, 10);
						if (!Number.isNaN(delta)) {
							const newW = Math.max(16, Math.min(60, current.width + delta));
							nextConfig.width = newW;
							nextConfig.enabled = true;
							ctx.ui.notify(`Sidebar width: ${newW} cols`, "info");
							break;
						}
					}
					const num = Number.parseInt(value, 10);
					if (Number.isNaN(num) || num < 16 || num > 60) {
						ctx.ui.notify(
							"Width must be between 16 and 60 columns. (e.g. /sidebar resize +4 or /sidebar resize 32)",
							"warning",
						);
						return;
					}
					nextConfig.width = num;
					nextConfig.enabled = true;
					ctx.ui.notify(`Sidebar width: ${num} cols`, "info");
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
					nextConfig.enabled = true;
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
