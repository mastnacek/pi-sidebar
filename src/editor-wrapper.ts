import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorOptions, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getActiveConfig } from "./config.js";

export class SidebarAwareEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		options?: EditorOptions,
	) {
		super(tui, theme, keybindings, options);
	}

	override render(width: number): string[] {
		const config = getActiveConfig();
		if (config.enabled && width >= config.minTerminalWidth) {
			const effectiveWidth = Math.max(20, width - config.width);
			const lines = super.render(effectiveWidth);
			return lines.map((line) => {
				const vis = visibleWidth(line);
				const pad = Math.max(0, width - vis);
				return line + " ".repeat(pad);
			});
		}
		return super.render(width);
	}
}
