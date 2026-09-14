#!/usr/bin/env node
// Claude PreToolUse hook (Edit|Write|NotebookEdit). Same handler and rule set
// as the Codex adapter; fails closed (exit 2) on any error. Claude may write
// outside the repository (memory, job scratch, a paired repo), so the
// repository boundary is not enforced here; the protected-name rule still is.
import { main } from './codex-hooks.mjs';

await main('PreToolUse', { confine: false });
