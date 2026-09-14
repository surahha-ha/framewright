#!/usr/bin/env node
// Claude PostToolUse hook (Edit|Write|NotebookEdit). Formats the edited files
// through the Prettier API (no shell), then runs guardrails and references in
// order, and tells the agent which files changed so it re-reads them.
import { main } from './codex-hooks.mjs';

await main('PostToolUse', { confine: false });
