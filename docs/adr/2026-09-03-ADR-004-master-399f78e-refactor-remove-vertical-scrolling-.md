# ADR-004: [master 399f78e] refactor: remove vertical scrolling feature and dead
- **Date:** 2026-09-03 08:21:12
- **Status:** active
- **Context:** Identified technical constraint requiring architectural resolution: refactor.
- **Decision:** warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'index.ts', LF will be replaced by CRLF the next time Git touches
- **Consequences:** Maintain this implementation to prevent regressions across environments.
