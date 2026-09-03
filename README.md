# pi-sidebar

OpenCode & Herdr-inspired right sidebar overlay extension for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

Provides an elegant, non-intrusive vertical sidebar docked to the right edge of the terminal, featuring **dynamic resizing**, **quick collapse**, live session metadata, context tokens, cumulative cost, active LSP tools, git workspace details, and provider quota meters.

---

## Features

- **Minimal Preset Hotkey (Herdr-Style)**:
  - `ctrl+shift+b` toggles the `minimal` gauge strip on/off — pressing again restores the previous preset (default `detailed`). Width auto-adjusts (10 cols for minimal, 28 for full presets).
  - Full collapse/expand still available via `/sidebar toggle`.
  - Permanent shortcut hints displayed on the bottom of the sidebar.
  - Layout-agnostic resizing (works on Czech & international keyboards) via `ctrl+shift+→` (wider) and `ctrl+shift+←` (narrower) or `/sidebar wider` / `/sidebar narrower`.
- **OpenCode Visual Fidelity & Rich Presets**:
  - `opencode`: Classic OpenCode sidebar layout.
  - `compact`: Minimal vertical line layout.
  - `detailed`: Full telemetry dashboard (Model & thinking levels with emojis, context progress bar, cache hit rates, token breakdown, and live Kimi / Z.ai quota meters).
  - `minimal`: Narrow gauge strip (~10 columns) — circular braille context ring with percentage, thinking emoji, colored quota mini-bar (`📶 NN%` = worst of provider windows), git status (`🌿 ●` dirty / `🌿 ○` clean, `↑N`/`↓N` ahead/behind), MCP (`🔌 ●/○`) and LSP (`💡 ●/○`) readiness dots. No text duplication with the footer. Legend in `/sidebar help`.
- **Top Session Banner**: Shows timestamp (`New session • HH:mm`) or active session title.
- **Model & Reasoning Telemetry**: Displays model ID, provider, and active thinking level emoji (`💤`, `🔹`, `🧊`, `⚡`, `🧠`, `🔥`, `🌋`).
- **Real-Time Context & Cost Meter**:
  - Visual progress bar `📊 ██░░░░ 23.0% (auto)`
  - Window capacity `46k / 200k tokens`
  - Cost `$0.012 spent`
- **Token & Cache Breakdown**:
  - `↑ 12k  ↓ 3k` input / output tokens
  - `📦 8k  🎯 95%` cache read & hit rate
- **Live Provider Quotas**:
  - **Kimi Coding**: Weekly quota, 5h window meter, reset timestamp.
  - **Z.ai / GLM**: 5h window, weekly quota, monthly web search count.
- **LSP / Tool Readiness**: Displays active LSP tools (`lotusscript_lsp`, `pi-lens`, `ast-grep`) or `LSPs disabled`.
- **Bottom Workspace & Git Dock**:
  - Formatted project path with active git branch (`/D:\path\to\project:main`)
  - Status indicators (`● dirty` / `○ clean`, `▸ahead`, `◂behind`)
  - Configurable branding footer (`• OpenCode 1.18.26` or `• Pi Agent v0.84.4`) with `«` collapse indicator.
- **Non-Capturing Overlay**: Rendered via Pi's native overlay system (`nonCapturing: true`) with zero impact on editor typing, keybindings, or cursor responsiveness.
- **Editor Boundary Wrapping**: Dynamically bounds the text input editor width so prompts stop before the sidebar boundary. When collapsed, input editor expands to full width.
- **Responsive Layout**: Automatically hides when the terminal window width is narrower than the configured threshold (default 80 columns).

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
| --- | --- | --- |
| `ctrl+shift+b` | **Toggle Collapse** | Collapse (`«`) or expand sidebar overlay |
| `ctrl+shift+right` | **Wider** | Increase sidebar column width (+4 columns) |
| `ctrl+shift+left` | **Narrower** | Decrease sidebar column width (-4 columns) |

---

## Commands & Usage

Control the sidebar at any time using the `/sidebar` slash command:

```text
/sidebar on|off|toggle     — Toggle collapse / expand
/sidebar collapse|expand   — Explicitly collapse or expand
/sidebar mcp on|off        — Toggle MCP servers section
/sidebar lsp on|off        — Toggle LSP section
/sidebar extensions on|off — Toggle remaining extension statuses
/sidebar wider [delta]     — Increase column width (default: +4)
/sidebar narrower [delta]  — Decrease column width (default: -4)
/sidebar width <16-60>     — Set exact column width (default: 28)
/sidebar preset <name>     — Switch layout preset (opencode | compact | detailed)
/sidebar refresh           — Force refresh Kimi and Z.ai quota meters
/sidebar branding <type>   — Switch branding footer (opencode | pi | custom <text>)
/sidebar border <style>    — Set border style (line | double | dotted | space | none)
/sidebar reset             — Reset settings to default
/sidebar help              — Display detailed help banner
```

> **Tip**: Append `--global` to any command (e.g. `/sidebar preset detailed --global`) to persist settings across all future sessions in `~/.pi/agent/pi-sidebar.json`.

---

## Configuration

Stored locally per-session or globally under `~/.pi/agent/pi-sidebar.json`:

```json
{
  "enabled": true,
  "width": 28,
  "minTerminalWidth": 80,
  "preset": "detailed",
  "branding": "pi",
  "borderStyle": "line",
  "showSession": true,
  "showModel": true,
  "showContext": true,
  "showCache": true,
  "showQuota": true,
  "showExtensions": false,
  "showLsp": true,
  "showGit": true
}
```

---

## License

MIT © mastnacek
