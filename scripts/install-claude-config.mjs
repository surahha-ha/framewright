#!/usr/bin/env node
// Copy `_claude-setup/` into `.claude/`.
//
// Cloud sessions cannot write to `.claude/` (it configures the agent, so remote
// writes are blocked by design). The tree is delivered to `_claude-setup/`
// instead and installed with one local command: `npm run setup:claude`.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const SRC = '_claude-setup';
const DEST = '.claude';

if (!existsSync(SRC)) {
  console.error(
    `setup:claude — nothing to install: ${SRC}/ is missing.\n` +
      `That folder is delivered by the cloud session; if it is not here, ask for it again.`,
  );
  process.exit(1);
}

function list(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...list(full, `${prefix}${name}/`));
    else out.push(prefix + name);
  }
  return out;
}

const files = list(SRC);
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true, force: true });

console.log(`setup:claude — installed ${files.length} file(s) into ${DEST}/:`);
for (const f of files) console.log(`  ${f}`);
console.log(
  '\nRestart the session (or /reload) so the hooks and subagents are picked up.\n' +
    `You can delete ${SRC}/ afterwards — it is only a delivery folder.`,
);
