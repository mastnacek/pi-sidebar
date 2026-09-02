# ADR-001: Eldritch-Footer Telemetry Integration in Pi-Sidebar Overlay
- **Date:** 2026-09-02 11:57:35
- **Status:** active
- **Context:** User requested a way to configure and display eldritch-footer telemetry (quota meters, reasoning thinking levels, context progress bar, cache hit rate, input/output token breakdown) in the right-hand sidebar overlay (pi-sidebar).
- **Decision:** 1. Implemented 'detailed' preset in pi-sidebar with rich multi-section layout matching eldritch-footer telemetry.
2. Added live quota polling for Kimi Coding (weekly and 5h window) and Z.ai / GLM Coding Plan (5h window, weekly, search quota).
3. Added support for thinking level indicators with emojis (🧠, ⚡, etc.), token breakdown (↑/↓), cache read/write with hit percentage (📦/🎯), and context usage bars.
4. Documented the configuration flow: switch pi-sidebar to '/sidebar preset detailed --global' and set eldritch-footer to '/footer minimal --global' (or '/footer off --global').
- **Consequences:** - Users can freely toggle between OpenCode fidelity (/sidebar preset opencode) and the full rich telemetry dashboard (/sidebar preset detailed).
- Clean separation of concerns: users can run /footer minimal --global or /footer off --global to clean up the bottom terminal statusline, moving all quota and token monitoring into the right-hand sidebar.
- Zero extra latency or blocking calls: quota polling is non-blocking with 60s caching and backoff on errors.
- Full compatibility with existing auth.json and models-store.json configurations.
