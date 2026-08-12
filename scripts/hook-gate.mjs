#!/usr/bin/env node
// Stop hook — the safety net for an autonomous loop.
//
// The agent has been told to keep going until the gate is green. This makes that
// non-negotiable: if the fast half of the gate is red, exit 2 refuses the stop
// and hands the failure back as feedback, so "I think it's done" cannot end a
// turn on a broken tree.
//
// e2e is deliberately NOT here — it costs ~35s and belongs to the explicit
// `npm run verify` the agent runs at the end of a unit of work. This hook is the
// cheap continuous half: refs, types, unit tests.
//
// Escape hatch: after 3 consecutive red stops it lets the turn end anyway. A
// hook that can never be satisfied is worse than no hook — it burns the whole
// context arguing with itself instead of telling the owner it is stuck.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_STRIKES = 3;
const STEPS = [
  ['refs', 'npm run check:refs'],
  ['guardrails', 'npm run check:guardrails'],
  ['typecheck', 'npm run typecheck'],
  ['unit tests', 'npm test'],
];

const strikeFile = join(
  tmpdir(),
  'framewright-gate',
  createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12),
);

function strikes() {
  try {
    return Number(readFileSync(strikeFile, 'utf8')) || 0;
  } catch {
    return 0;
  }
}
function setStrikes(n) {
  try {
    mkdirSync(join(tmpdir(), 'framewright-gate'), { recursive: true });
    writeFileSync(strikeFile, String(n));
  } catch {
    // a missing counter only costs us the escape hatch; never crash the hook
  }
}

function run() {
  for (const [name, cmd] of STEPS) {
    try {
      execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim();
      return { name, out: out.slice(-3000) };
    }
  }
  return null;
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const failure = run();

  if (!failure) {
    setStrikes(0);
    process.exit(0);
  }

  const n = strikes() + 1;
  if (n >= MAX_STRIKES) {
    setStrikes(0);
    // Let the turn end, but make the state impossible to misreport.
    process.stdout.write(
      `GATE STILL RED after ${MAX_STRIKES} attempts (${failure.name}).\n` +
        `Do not describe this work as done. Record the failure in docs/STATUS.md ` +
        `— what fails, what you already ruled out — and tell the owner you are stuck.\n`,
    );
    process.exit(0);
  }

  setStrikes(n);
  process.stderr.write(
    `Gate is red: ${failure.name} failed (attempt ${n}/${MAX_STRIKES}). ` +
      `Fix it before finishing.\n\n${failure.out}\n`,
  );
  process.exit(2); // 2 = block the stop, feed stderr back to the agent
});
