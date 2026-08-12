#!/usr/bin/env node
// SessionStart hook — enforce the entry ritual by making it unavoidable.
//
// A fresh session has no memory. Printing the live handoff at the top of the
// transcript means the next agent starts from what is TRUE (the stamped gate
// result and the next single step) instead of from whatever it infers.

import { readFileSync } from 'node:fs';

function section(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return [heading, ...(end < 0 ? rest : rest.slice(0, end))].join('\n').trim();
}

try {
  const status = readFileSync('docs/STATUS.md', 'utf8');

  const verify = status
    .split('<!-- VERIFY:BEGIN')[1]
    ?.split('<!-- VERIFY:END')[0]
    ?.replace(/^[^\n]*-->/, '')
    .trim();

  const parts = [
    '=== framewright handoff (docs/STATUS.md) ===',
    verify ?? '(no verification stamp — run `npm run handoff`)',
    section(status, '## Where we are'),
    section(status, '## Next single step'),
    section(status, '## Blocked / needs the owner'),
    '',
    'Read docs/STATUS.md, docs/HANDOVER.md and CLAUDE.md in full before editing.',
    'Then run `npm run verify` FIRST — the stamp is what the last session believed,',
    'the gate is what is true. If they disagree, the gate wins and that is job #1.',
  ].filter(Boolean);

  process.stdout.write(parts.join('\n\n') + '\n');
} catch {
  process.stdout.write(
    'docs/STATUS.md is missing. Read CLAUDE.md and docs/HANDOVER.md, then run `npm run verify`.\n',
  );
}
process.exit(0);
