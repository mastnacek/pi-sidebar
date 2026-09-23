# pi-sidebar

Herdr-pane telemetry panel for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

pi-sidebar renders **exclusively in a dedicated herdr pane** — an external terminal
window beside the Pi session, not part of the Pi TUI. The extension itself owns no
overlay and never touches the editor: it writes a small JSON snapshot and invokes
the herdr CLI, and a standalone renderer (`src/pane/renderer.mjs`) paints that
snapshot inside the pane.

Requires a herdr session (`HERDR_BIN_PATH` + `HERDR_PANE_ID`). Outside herdr the
plugin stays idle and reports that the pane is unavailable.

---

## Features

- **Statusline parity**: the pane shows the exact same values and precision as the
  real statusline (eldritch-footer / engine footer), never rounded:
  - Context `📊 ██████░░░░░░░░ 42.5%/200k (auto)` — `percent.toFixed(1)` + window tokens + auto-compaction flag
  - Cost `💰 $0.050` (4dp under a cent, 3dp under a dollar)
  - Token totals `⬆️ 1.5k  ⬇️ 450`
  - Cache `📦 25k (w:1.0k) 🎯95%`
  - Git `🌿 branch ●dirty/○clean ▸N ahead ◂N behind`
  - Model `(provider) model • 🧠 high`
- **Full text, never truncated**: long paths, model names and session titles
  **wrap** across lines instead of painting `…` / `...`. Widen the pane and the
  complete value is shown.
- **Two switchable faces**:
  - `status` — telemetry (context, cost, tokens, cache, git, model).
  - `skills` — the pi-plugin-dev skill HUD (references, focus, compliance gates)
    read from the shared `pi-plugin-dev:state` event bus.
- **Clickable tab strip** inside the pane: clicking `Status` / `Skills` persists
  the choice through the same path as `/sidebar tab`.
- **Pane keep-alive**: optionally leave the last frame in the pane after the
  session ends.
- **No LLM context**: the extension only writes a local JSON file and invokes the
  herdr CLI; it appends nothing to the conversation.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `ctrl+shift+t` | Switch pane tab (Status ↔ Skills) |

---

## Commands

```text
/sidebar on|off|toggle   — Open / close / toggle the herdr pane
/sidebar width <N>       — Exact pane width in columns (16-120)
/sidebar wider|narrower  — Pane width ±4 columns
/sidebar tab <face>      — status | skills | next | prev
/sidebar refresh         — Force refresh of Kimi and Z.ai quota meters
/sidebar status          — Current pane state
/sidebar reset           — Restore default settings
/sidebar help            — Detailed help banner
```

> **Tip**: Append `--global` to any command (e.g. `/sidebar width 80 --global`) to
> persist settings across all future sessions in `~/.pi/agent/pi-sidebar.json`.

---

## Configuration

Stored per-session (via a session entry) or globally under
`~/.pi/agent/pi-sidebar.json`:

```json
{
  "enabled": true,
  "tab": "status",
  "paneWidth": 40,
  "paneKeepAlive": false,
  "showSession": true,
  "showGit": true
}
```

---

## License

MIT © mastnacek
