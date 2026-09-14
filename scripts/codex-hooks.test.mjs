import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkedPath,
  editPaths,
  formatFiles,
  stopOutput,
  root,
  runNode,
} from './codex-hooks.mjs';

function patch(command) {
  return {
    hook_event_name: 'PreToolUse',
    cwd: root,
    tool_name: 'apply_patch',
    tool_input: { command },
  };
}

test('extracts add/update/delete and both sides of a rename, excluding patch content', () => {
  const paths = editPaths(
    patch(
      '*** Begin Patch\r\n*** Update File: src/old.ts\r\n*** Move to: src/new.ts\r\n+*** Delete File: fake\r\n*** Add File: docs/한 글.md\r\n*** Delete File: src/gone.ts\r\n*** End Patch',
    ),
  );
  assert.deepEqual(paths, [
    'src/old.ts',
    'src/new.ts',
    'docs/한 글.md',
    'src/gone.ts',
  ]);
  assert.deepEqual(
    editPaths({ tool_name: 'Write', tool_input: { file_path: 'docs/a.md' } }),
    ['docs/a.md'],
  );
});

test('protects normalized, absolute, mixed-case and rename targets', () => {
  for (const file of [
    'package-lock.json',
    'src/../.env.local',
    '.git/config',
    'PNPM-LOCK.YAML',
    join(root, '.ENV'),
    '../other.md',
  ]) {
    assert.throws(() => checkedPath(file, root));
  }
  assert.equal(
    checkedPath('time.ts', join(root, 'src/engine')),
    join(root, 'src/engine/time.ts'),
  );
  const renamed = editPaths(
    patch(
      '*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: .env\n*** End Patch',
    ),
  );
  assert.throws(() => renamed.map((file) => checkedPath(file, root)));
});

test('does not silently accept a changed input contract', () => {
  assert.throws(() => editPaths(patch(undefined)), /Unrecognized/);
  assert.throws(
    () => editPaths({ tool_name: 'Write', tool_input: {} }),
    /Missing/,
  );
});

test('checks the resolved parent of a new file inside a junction or symlink', (t) => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'fw-hook-paths-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const workspace = join(temp, 'repo');
  const outside = join(temp, 'outside');
  mkdirSync(workspace);
  mkdirSync(outside);
  symlinkSync(
    outside,
    join(workspace, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => checkedPath('linked/new.md', workspace, workspace),
    /outside/,
  );
});

test('formatting handles spaces and shell metacharacters, ignored and deleted files', async (t) => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'fw-hook-format-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  writeFileSync(join(temp, '.prettierignore'), 'ignored.json\n');
  const file = join(temp, '한 글 $(literal).json');
  const ignored = join(temp, 'ignored.json');
  writeFileSync(file, '{"a":1}');
  writeFileSync(ignored, '{"a":1}');
  assert.deepEqual(
    await formatFiles([file, file, ignored, join(temp, 'deleted.json')], temp),
    ['한 글 $(literal).json'],
  );
  assert.equal(readFileSync(file, 'utf8'), '{ "a": 1 }\n');
  assert.equal(readFileSync(ignored, 'utf8'), '{"a":1}');
});

test('Stop emits valid success, continuation and bounded failure output', () => {
  assert.deepEqual(stopOutput({}, null), {});
  assert.equal(stopOutput({}, 'type error').decision, 'block');
  const repeated = stopOutput({ stop_hook_active: true }, 'type error');
  assert.equal(repeated.decision, undefined);
  assert.match(repeated.systemMessage, /type error/);
});

test('a failed or unlaunchable check cannot be reported as green', () => {
  assert.throws(() => runNode(['-e', 'process.exit(1)']), /failed/);
  assert.throws(
    () =>
      runNode(['-e', 'process.exit(0)'], join(root, 'nonexistent-hook-cwd')),
    /failed/,
  );
});

test('real runner blocks protected edits and malformed payloads', () => {
  for (const input of [
    JSON.stringify(
      patch(
        '*** Begin Patch\n*** Delete File: package-lock.json\n*** End Patch',
      ),
    ),
    '{invalid',
  ]) {
    const result = spawnSync(process.execPath, ['scripts/codex-hooks.mjs'], {
      cwd: root,
      input,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Framewright hook/);
  }
});

test('configured launcher works from a subdirectory and returns session JSON', () => {
  const preview = spawnSync(
    process.execPath,
    ['scripts/install-codex-hooks.mjs'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(preview.status, 0, preview.stderr);
  const config = JSON.parse(preview.stdout);
  assert.equal(Object.keys(config.hooks).length, 4);
  const command = config.hooks.SessionStart[0].hooks[0].command;
  const result = spawnSync(command, {
    cwd: resolve(root, 'src/engine'),
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      cwd: join(root, 'src/engine'),
      source: 'compact',
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /framewright handoff/,
  );
});
