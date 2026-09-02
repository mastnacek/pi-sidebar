# ADR-002: Removal of Conflicting Alt+ Shortcuts in Favor of Standard Pi Keybindings

- **Date:** 2026-09-02 13:00:00
- **Status:** active
- **Context:** `alt+left` and `alt+right` conflicted with built-in `tui.editor.cursorWordLeft` and `tui.editor.cursorWordRight`, breaking word-by-word cursor jumping in the prompt editor. `alt+up` and `alt+down` conflicted with `app.message.dequeue` and `app.models.reorderUp/Down`.
- **Decision:** Removed `alt+left`, `alt+right`, `alt+up`, and `alt+down` shortcut registrations from `index.ts`. Retained standard non-conflicting `ctrl+shift+b`, `ctrl+shift+left/right`, `ctrl+shift+up/down`, and `ctrl+shift+pageUp/pageDown`.
- **Consequences:** Editor cursor navigation remains fully responsive and unaffected. Sidebar resizing and scrolling remain accessible via standard `ctrl+shift+` shortcuts and slash commands.
