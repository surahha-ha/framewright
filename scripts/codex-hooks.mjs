#!/usr/bin/env node
// Agent lifecycle handler. Codex calls it through .codex/hooks.json; the Claude
// hooks (hook-protect, hook-format) call the same handle() so both agents run
// one rule set in one order. The path rule itself lives in protected-paths.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  root,
  editPaths,
  checkedPath,
  shellDenial,
} from './protected-paths.mjs';

export { root, editPaths, checkedPath, shellDenial };

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

export async function handle(payload, { confine = true } = {}) {
  const event = payload.hook_event_name;
  if (event === 'SessionStart') {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: runNode(['scripts/hook-session-start.mjs']).trim(),
      },
    };
  }
  // Codex names its shell tool Bash in hook payloads; a shell command must not
  // be the way around the edit rule.
  if (event === 'PreToolUse' && payload.tool_name === 'Bash') {
    const reason = shellDenial(payload);
    return reason
      ? {
          hookSpecificOutput: {
            hookEventName: event,
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }
      : {};
  }
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    const files = editPaths(payload).map((file) =>
      checkedPath(file, payload.cwd || root, root, { confine }),
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

// Fail closed: any error, an unreadable payload included, is exit 2 so the
// agent runtime blocks the call instead of proceeding unguarded.
export async function main(expectedEvent, options = {}) {
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    if (expectedEvent && payload.hook_event_name !== expectedEvent) {
      throw new Error(
        `Expected a ${expectedEvent} payload, got ${payload.hook_event_name}.`,
      );
    }
    process.stdout.write(JSON.stringify(await handle(payload, options)) + '\n');
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
