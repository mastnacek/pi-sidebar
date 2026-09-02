# pi-sidebar

OpenCode-style right sidebar overlay extension for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

Provides an elegant, non-intrusive vertical sidebar docked to the right edge of the terminal, displaying live session metadata, context tokens, cumulative cost, active LSP tools, and git workspace details.

---

## Features

- **OpenCode Visual Fidelity**: Exact layout and typography matching the OpenCode sidebar.
- **Top Session Banner**: Shows timestamp (`New session - YYYY-MM-DDTHH:mm:ss.sssZ`) or active session title.
- **Real-Time Context & Cost Meter**:
  - `0 tokens` / `15.2k tokens`
  - `0% used` / `12% used` (auto-calculated from active model context window)
  - `$0.00 spent` / `$0.04 spent`
- **LSP / Tool Readiness**: Displays active LSP tools (`lotusscript_lsp`, `pi-lens`, `ast-grep`) or `LSPs are disabled`.
- **Bottom Workspace & Git Dock**:
  - Formatted project path with active git branch (`/D:\path\to\project:master`)
  - Configurable branding footer (`• OpenCode 1.18.26` or `• Pi Agent v0.84.4`)
- **Non-Capturing Overlay**: Rendered via Pi's native overlay system (`nonCapturing: true`) with zero impact on editor typing, keybindings, or cursor responsiveness.
- **Editor Boundary Wrapping**: Dynamically bounds the text input editor width so prompts stop before the sidebar boundary.
- **Responsive Layout**: Automatically hides when the terminal window width is narrower than the configured threshold (default 80 columns).

---

## Installation

### Local Installation

Add to `~/.pi/agent/settings.json` under `packages`:

```json
{
  "packages": [
    "D:/01_programovani/pi/plugins/pi-sidebar"
  ]
}
```

Or via Git package:

```json
{
  "packages": [
    "git:github.com/mastnacek/pi-sidebar"
  ]
}
```

---

## Commands & Usage

Control the sidebar at any time using the `/sidebar` slash command:

```text
/sidebar on|off|toggle     — Toggle sidebar visibility
/sidebar status            — Show active configuration & metrics
/sidebar width <16-60>     — Adjust column width (default: 28)
/sidebar preset <name>     — Switch layout preset (opencode | compact | detailed)
/sidebar branding <type>   — Switch branding footer (opencode | pi | custom <text>)
/sidebar border <style>    — Set border style (line | double | dotted | space | none)
/sidebar reset             — Reset settings to default
/sidebar help              — Display detailed help banner
```

> **Tip**: Append `--global` to any command (e.g. `/sidebar width 32 --global`) to persist settings across all future sessions in `~/.pi/agent/pi-sidebar.json`.

---

## Configuration

Stored locally per-session or globally under `~/.pi/agent/pi-sidebar.json`:

```json
{
  "enabled": true,
  "width": 28,
  "minTerminalWidth": 80,
  "preset": "opencode",
  "branding": "opencode",
  "borderStyle": "line",
  "showLsp": true,
  "showContext": true,
  "showGit": true,
  "showSession": true
}
```

---

## License

MIT © mastnacek
