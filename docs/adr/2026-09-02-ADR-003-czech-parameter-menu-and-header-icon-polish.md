# ADR-003: Czech Parameter Menu and Header Icon Polish

- **Date:** 2026-09-02 13:30:00
- **Status:** active
- **Context:** Slash command help, parameter autocompletion hints, and sidebar section headers had mixed language formatting and lacked standardized icons matching the Czech ecosystem plugins (`pi-prompt-translate-czk`, `pi-tts`, `pi-solodev-adr`, `pi-spai`, `eldritch-footer`).
- **Decision:** Fully localized `COMMAND_DOCS`, 2nd-level argument completion descriptions, status notifications, and section headers (`RELACE`, `MODEL`, `KONTEXT`, `TOKENY A CACHE`, `KVÓTY`, `ROZŠÍŘENÍ`, `NÁSTROJE / LSP`, `PRACOVNÍ PROSTOR`, `ZKRATKY`) to Czech with dedicated icons and duplicate-emoji stripping for extension statusline items.
- **Consequences:** Consistent localization and visual ergonomics across the entire plugin ecosystem.
