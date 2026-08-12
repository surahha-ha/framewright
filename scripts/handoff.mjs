#!/usr/bin/env node
// framewright — stamp the verification gate's real result into docs/STATUS.md.
//
// The point is that "last verified" cannot be a promise. This runs the gate and
// writes what actually happened, pass or fail, so a session picking the work up
// can tell the difference between "green" and "someone said green".

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = join(root, 'docs', 'STATUS.md');
const BEGIN = '<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->';
const END = '<!-- VERIFY:END -->';

/** Run the gate. Never throw — a red gate is a result worth recording. */
function runGate() {
  try {
    const out = execSync('npm run verify', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' },
    });
    return { ok: true, out };
  } catch (e) {
    return {
      ok: false,
      out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`,
    };
  }
}

/**
 * Pull the numbers out rather than pasting a wall of log.
 *
 * Two traps, both hit in practice: the runners colour their output, so a naive
 * regex silently matches nothing; and vitest's own "11 passed (11)" looks
 * exactly like Playwright's "23 passed (33.8s)". So strip ANSI first, then split
 * the log at the e2e lifecycle banner and read each half on its own terms.
 * A summary that quietly drops the unit count is worse than no summary — it
 * reads as "the unit tests didn't run".
 */
function summarise(raw) {
  // eslint-disable-next-line no-control-regex
  const out = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const marker = out.indexOf('framewright@0.0.1 e2e');
  const unitLog = marker < 0 ? out : out.slice(0, marker);
  const e2eLog = marker < 0 ? '' : out.slice(marker);

  const parts = [];
  const unitPass = unitLog.match(/Tests\s+(\d+) passed/);
  const unitFail = unitLog.match(/Tests\s+.*?(\d+) failed/);
  if (unitPass) {
    parts.push(
      `unit ${unitPass[1]} passed${unitFail ? `, ${unitFail[1]} failed` : ''}`,
    );
  }

  const e2ePass = e2eLog.match(/(\d+) passed/);
  const e2eFail = e2eLog.match(/(\d+) failed/);
  if (e2ePass || e2eFail) {
    parts.push(
      `e2e ${e2ePass?.[1] ?? 0} passed${e2eFail ? `, ${e2eFail[1]} failed` : ''}`,
    );
  } else if (e2eLog) {
    parts.push('e2e did not run to completion');
  }

  return parts.join(' · ') || 'no test counts found in output';
}

/**
 * Some red gates are not about the code at all. Naming them stops the next
 * session from hunting a bug that isn't there.
 */
const INFRA = [
  [
    /is already used, make sure that nothing is running/,
    'the dev server port is occupied — Playwright refused to reuse it. This is ' +
      'environment, not code: check `reuseExistingServer` in playwright.config.ts.',
  ],
  [
    /Timed out waiting .* from config\.webServer/,
    'the dev server never came up at the expected address — a host/port mismatch. ' +
      '`dev-server.ts` is the single source of truth; see docs/TESTING.md.',
  ],
  [
    /Executable doesn't exist|playwright install/,
    'Playwright browsers are not installed — run `npx playwright install`.',
  ],
  [
    /Cannot find module|ERR_MODULE_NOT_FOUND/,
    'a dependency is missing — run `npm install`.',
  ],
];

function diagnose(out) {
  for (const [re, why] of INFRA) if (re.test(out)) return why;
  return null;
}

/** First failing spec/suite name, so the next session knows where to look. */
function firstFailure(out) {
  const line = out
    .split('\n')
    .find((l) => /^\s*\d+\)\s|✘|FAIL /.test(l));
  return line ? line.trim().slice(0, 160) : null;
}

const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const { ok, out } = runGate();
const failure = ok ? null : firstFailure(out);
const infra = ok ? null : diagnose(out);

const block = [
  BEGIN,
  '',
  `**Last verified:** ${stamp} — \`npm run verify\` **${ok ? 'GREEN' : 'RED'}**`,
  '',
  `- ${summarise(out)}`,
  ...(infra ? [`- **not a code failure**: ${infra}`] : []),
  ...(failure && !infra ? [`- first failure: \`${failure}\``] : []),
  ...(ok
    ? []
    : [
        infra
          ? '- Fix the environment and re-run `npm run handoff` before judging the code.'
          : '- **Do not start new work on a red gate.** Fix this first.',
      ]),
  '',
  END,
].join('\n');

const status = readFileSync(statusPath, 'utf8');
const start = status.indexOf(BEGIN);
const stop = status.indexOf(END);
if (start < 0 || stop < 0) {
  console.error(
    'handoff: docs/STATUS.md is missing its VERIFY markers — restore them and re-run.',
  );
  process.exit(1);
}

writeFileSync(
  statusPath,
  status.slice(0, start) + block + status.slice(stop + END.length),
);

console.log(`handoff: stamped docs/STATUS.md — ${ok ? 'GREEN' : 'RED'}`);
if (!ok) {
  console.log(out.slice(-4000));
  process.exit(1);
}
