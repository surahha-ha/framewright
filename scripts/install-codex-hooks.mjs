#!/usr/bin/env node
// Preview by default; --install creates the reviewed project configuration.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './codex-hooks.mjs';

const command = `node -e "const p=require('node:path');const r=require('node:child_process').execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();import(require('node:url').pathToFileURL(p.join(r,'scripts/codex-hooks.mjs')).href).then(m=>m.main())"`;
const handler = (timeout, statusMessage) => ({
  type: 'command',
  command,
  timeout,
  statusMessage,
});
export const config = {
  description:
    'Framewright: session context, protected edits, formatting and validation.',
  hooks: {
    SessionStart: [
      {
        matcher: '^(startup|resume|clear|compact)$',
        hooks: [
          {
            ...handler(10, 'Loading Framewright handoff'),
            additionalContextLimit: 1500,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: '^(apply_patch|Edit|Write)$',
        hooks: [handler(10, 'Checking protected files')],
      },
    ],
    PostToolUse: [
      {
        matcher: '^(apply_patch|Edit|Write)$',
        hooks: [handler(120, 'Formatting and checking edited files')],
      },
    ],
    Stop: [
      {
        hooks: [
          handler(
            240,
            'Checking references, guardrails, hook tests, types and unit tests',
          ),
        ],
      },
    ],
  },
};

const serialized = JSON.stringify(config, null, 2) + '\n';
if (process.argv.includes('--install')) {
  const directory = join(root, '.codex');
  const destination = join(directory, 'hooks.json');
  const toml = join(directory, 'config.toml');
  if (
    existsSync(toml) &&
    /^\s*\[\[?hooks(?:\.|\])/m.test(readFileSync(toml, 'utf8'))
  ) {
    throw new Error(
      'Existing inline hooks found in .codex/config.toml. Review before adding a second source.',
    );
  }
  if (existsSync(destination)) {
    if (readFileSync(destination, 'utf8') !== serialized) {
      throw new Error(
        'Existing .codex/hooks.json differs; refusing to overwrite it.',
      );
    }
    console.log('Project hook configuration already matches.');
  } else {
    mkdirSync(directory, { recursive: true });
    writeFileSync(destination, serialized, { flag: 'wx' });
    console.log(`Installed ${destination}`);
  }
  console.log(
    'Restart Codex in this repository and review/trust the four hooks with /hooks.',
  );
} else {
  process.stdout.write(serialized);
}
