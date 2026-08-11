// framewright guardrails — enforces the CLAUDE.md rules on the engine.
// Scans src/engine/**/*.ts(x) (excluding tests) for forbidden patterns.
// Used both as `npm run check:guardrails` and as a PostToolUse hook.
// Exit 2 => blocking feedback (stderr shown to the agent).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/engine';
const FORBIDDEN = [
  { re: /\bDate\.now\s*\(/, msg: 'Date.now() in engine — use the master clock / deterministic ids' },
  { re: /\bMath\.random\s*\(/, msg: 'Math.random() in engine — ids must be deterministic' },
  { re: /from\s+['"]react['"]/, msg: 'React import in engine — the engine must be framework-agnostic' },
  // Browser-only globals make the engine untestable in Node. `globalThis` is fine.
  { re: /(^|[^.\w])window\s*[.[]/, msg: 'window in engine — use globalThis with a guard' },
  { re: /(^|[^.\w])document\s*[.[]/, msg: 'document in engine — the engine must not touch the DOM' },
  { re: /\brequestAnimationFrame\s*\(/, msg: 'requestAnimationFrame in engine — timing belongs to the UI layer' },
];

// Comments explain the rules (and quote the banned names), so scan code only.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const { re, msg } of FORBIDDEN) {
        if (re.test(src)) violations.push(`${p}: ${msg}`);
      }
    }
  }
}

try {
  walk(ROOT);
} catch {
  // engine dir may not exist yet — nothing to check
}

if (violations.length) {
  process.stderr.write(
    'framewright guardrail violations (see CLAUDE.md):\n- ' +
      violations.join('\n- ') +
      '\n',
  );
  process.exit(2);
}
process.exit(0);
