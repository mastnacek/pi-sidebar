# ADR-003: Architectural Workaround & Constraint
- **Date:** 2026-09-02 12:22:07
- **Status:** active
- **Context:** Identified technical constraint requiring architectural resolution: refactor.
- **Decision:** warning: in the working copy of 'docs/adr/.index.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/commands.ts', LF will be replaced by CRLF the next
- **Consequences:** Maintain this implementation to prevent regressions across environments.
