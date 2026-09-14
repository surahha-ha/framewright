#!/usr/bin/env node
// Codex lifecycle adapter. Claude's existing hooks remain independent.
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  realpathSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// apply_patch uses command, including multiple files and rename destinations.
export function editPaths(payload) {
  if (payload.tool_name === 'apply_patch') {
    const patch = payload.tool_input?.command;
    if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch')) {
      throw new Error(
        'Unrecognized apply_patch input; expected tool_input.command.',
      );
    }
    return [
      ...patch.matchAll(
        /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm,
      ),
    ].map((match) => match[1].trim());
  }
  const file = payload.tool_input?.file_path;
  if (typeof file !== 'string' || !file)
    throw new Error('Missing edit file_path.');
  return [file];
}

// Resolve existing parents too: a new file may be inside a symlink/junction.
function physicalPath(file) {
  if (existsSync(file)) return realpathSync(file);
  const parent = dirname(file);
  return parent === file
    ? file
    : join(physicalPath(parent), relative(parent, file));
}

export function checkedPath(file, cwd, workspace = root) {
  const base = realpathSync(workspace);
  const absolute = resolve(cwd, file);
  for (const candidate of [absolute, physicalPath(absolute)]) {
    const rel = relative(base, candidate).replace(/\\/g, '/');
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) {
      throw new Error('Edit target is outside this repository.');
    }
    if (
      /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|\.env(?:\.[^/]*)?|\.git)(?:\/|$)/i.test(
        rel,
      )
    ) {
      throw new Error('Protected edit target: lockfile, .env, or .git.');
    }
  }
  return absolute;
}

export function runNode(args, cwd = root) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(
        -3000,
      ),
    );
  }
  return result.stdout;
}

export async function formatFiles(files, workspace = root) {
  const prettier = await import('prettier');
  const changed = [];
  for (const file of new Set(files)) {
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const info = await prettier.getFileInfo(file, {
      ignorePath: join(workspace, '.prettierignore'),
      withNodeModules: false,
    });
    if (info.ignored || !info.inferredParser) continue;
    const before = readFileSync(file, 'utf8');
    const options = (await prettier.resolveConfig(file)) ?? {};
    const after = await prettier.format(before, { ...options, filepath: file });
    if (after !== before) {
      writeFileSync(file, after);
      changed.push(relative(workspace, file).replace(/\\/g, '/'));
    }
  }
  return changed;
}

export function stopOutput(payload, failure) {
  if (!failure) return {};
  const reason = `Framewright validation failed:\n${failure}\nFix the failure and rerun the relevant checks. Report any pre-existing or environment failure accurately.`;
  // A second red Stop reports the failure without creating an endless turn.
  return payload.stop_hook_active
    ? { systemMessage: reason }
    : { decision: 'block', reason };
}

export async function handle(payload) {
  const event = payload.hook_event_name;
  if (event === 'SessionStart') {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: runNode(['scripts/hook-session-start.mjs']).trim(),
      },
    };
  }
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    const files = editPaths(payload).map((file) =>
      checkedPath(file, payload.cwd || root),
    );
    if (event === 'PreToolUse') return {};
    const changed = await formatFiles(files);
    // One handler imposes order: format finishes before both static checks.
    runNode(['scripts/check-guardrails.mjs']);
    runNode(['scripts/check-references.mjs']);
    return {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: changed.length
          ? `Prettier updated ${changed.join(', ')}. Re-read the formatted files before further edits. Guardrails and references passed.`
          : 'Guardrails and references passed.',
      },
    };
  }
  if (event === 'Stop') {
    try {
      for (const args of [
        ['scripts/check-references.mjs'],
        ['scripts/check-guardrails.mjs'],
        ['--test', 'scripts/codex-hooks.test.mjs'],
        ['node_modules/typescript/bin/tsc', '--noEmit'],
        ['node_modules/vitest/vitest.mjs', 'run'],
      ])
        runNode(args);
      return stopOutput(payload, null);
    } catch (error) {
      return stopOutput(payload, error.message);
    }
  }
  throw new Error(`Unsupported hook event: ${event}`);
}

export async function main() {
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    process.stdout.write(JSON.stringify(await handle(payload)) + '\n');
  } catch (error) {
    process.stderr.write(`Framewright hook: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
