# pi-sidebar

OpenCode-style right sidebar overlay extension for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

Provides an elegant, non-intrusive vertical sidebar docked to the right edge of the terminal, displaying live session metadata, context tokens, cumulative cost, active LSP tools, git workspace details, and provider quota meters.

---

## Features

- **OpenCode Visual Fidelity & Rich Presets**:
  - `opencode`: Exact layout matching classic OpenCode sidebar.
  - `compact`: Space-saving vertical layout.
  - `detailed`: Full multi-section dashboard replicating the rich telemetry from `eldritch-footer` (Model & thinking levels, context progress bar, cache hit rates, token breakdown, and live Kimi / Z.ai quota meters).
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
  - Configurable branding footer (`• OpenCode 1.18.26` or `• Pi Agent v0.84.4`)
- **Non-Capturing Overlay**: Rendered via Pi's native overlay system (`nonCapturing: true`) with zero impact on editor typing, keybindings, or cursor responsiveness.
- **Editor Boundary Wrapping**: Dynamically bounds the text input editor width so prompts stop before the sidebar boundary.
- **Responsive Layout**: Automatically hides when the terminal window width is narrower than the configured threshold (default 80 columns).

---

## Coexisting with `eldritch-footer`

When using `pi-sidebar` with the `detailed` preset, all telemetry previously in `eldritch-footer` moves to the right sidebar. You can configure `eldritch-footer` accordingly:

1. **Clean 1-Line Footer**: Keep a minimal single-line statusbar at the bottom while viewing full metrics in the sidebar:

   ```text
   /footer minimal --global
   ```

2. **Disable Footer Entirely**: Move all stats exclusively to the sidebar:

   ```text
   /footer off --global
   ```

3. **Switch Sidebar to Detailed Mode**:

   ```text
   /sidebar preset detailed --global
   ```

---

## Commands & Usage

Control the sidebar at any time using the `/sidebar` slash command:

```text
/sidebar on|off|toggle     — Toggle sidebar visibility
/sidebar status            — Show active configuration & metrics
/sidebar preset <name>     — Switch layout preset (opencode | compact | detailed)
/sidebar refresh           — Force refresh Kimi and Z.ai quota meters
/sidebar width <16-60>     — Adjust column width (default: 28)
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
  "showLsp": true,
  "showGit": true
}
```

---

## License

MIT © mastnacek
