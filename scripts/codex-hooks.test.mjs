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
  shellDenial,
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

function shell(command) {
  return {
    hook_event_name: 'PreToolUse',
    cwd: root,
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function launcherCommand() {
  const preview = spawnSync(
    process.execPath,
    ['scripts/install-codex-hooks.mjs'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(preview.status, 0, preview.stderr);
  const config = JSON.parse(preview.stdout);
  assert.equal(Object.keys(config.hooks).length, 4);
  return config.hooks.SessionStart[0].hooks[0].command;
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
  assert.deepEqual(
    editPaths({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'docs/a.ipynb' },
    }),
    ['docs/a.ipynb'],
  );
});

test('protects normalized, absolute, mixed-case and rename targets', () => {
  for (const file of [
    'package-lock.json',
    'src/../.env.local',
    '.git/config',
    '.git',
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

test('protects secrets, keys, hook configuration and executable prettier config; not their look-alikes', () => {
  for (const file of [
    '.npmrc',
    '.envrc',
    'certs/server.pem',
    'certs/server.key',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.codex/hooks.json',
    '.codex/config.toml',
    'prettier.config.mjs',
    '.prettierrc.cjs',
  ]) {
    assert.throws(() => checkedPath(file, root), /Protected/, file);
  }
  for (const file of [
    '.gitignore',
    '.github/workflows/ci.yml',
    '.environment',
    'src/env.ts',
    'docs/keynote.md',
    '.prettierrc.json',
    '.codex/agents/reviewer.toml',
  ]) {
    assert.doesNotThrow(() => checkedPath(file, root), file);
  }
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

test(
  'Windows: 8.3 short names resolve to the protected long name; ambiguous spellings are refused',
  {
    skip: process.platform !== 'win32' && 'win32 only',
  },
  (t) => {
    const temp = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'fw-hook-short-')),
    );
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const long = join(temp, 'package-lock.json');
    writeFileSync(long, '{}');
    // cmd.exe argument quoting does not survive spawn's escaping; pass verbatim.
    const short = spawnSync(
      'cmd.exe',
      ['/d', '/c', `for %I in ("${long}") do @echo %~snxI`],
      { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true },
    )
      .stdout.trim()
      .split(/\r?\n/)
      .pop();
    // A volume without 8.3 names hands the long name back; then there is
    // nothing to resolve and the case is covered by the plain name test.
    t.diagnostic(`8.3 spelling of package-lock.json: ${short}`);
    if (/~\d/.test(short)) {
      assert.throws(() => checkedPath(short, temp, temp), /Protected/, short);
    }
    for (const file of [
      'package-lock.json.',
      'package-lock.json ',
      'package-lock.json:stream',
    ]) {
      assert.throws(() => checkedPath(file, temp, temp), /ambiguous|Protected/);
    }
  },
);

test('shell commands that write, move or delete a protected file are denied; reads and look-alikes pass', () => {
  for (const command of [
    'rm package-lock.json',
    'rm -rf .git',
    'Remove-Item .env.local',
    'echo secret > .env',
    'cat x >> .npmrc',
    'git checkout -- package-lock.json',
    'mv .npmrc old.txt',
    'cp evil.json .claude/settings.json',
    'sed -i "s/a/b/" pnpm-lock.yaml',
    'npm test && rm certs/server.pem',
    "Set-Content -Path '.codex/hooks.json' -Value '{}'",
    ['bash', '-lc', 'rm .env'],
  ]) {
    assert.ok(shellDenial(shell(command)), String(command));
  }
  for (const command of [
    'cat .env',
    'git diff package-lock.json',
    'npm install',
    'rm .gitignore',
    'echo x > .environment',
    'rm src/env.ts',
    'git commit -m "remove .env from history"',
    'grep -r package-lock.json docs/',
  ]) {
    assert.equal(shellDenial(shell(command)), null, String(command));
  }
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

test('real runner blocks protected edits, denies protected shell writes and fails closed on bad payloads', () => {
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
  const denied = spawnSync(process.execPath, ['scripts/codex-hooks.mjs'], {
    cwd: root,
    input: JSON.stringify(shell('rm .env')),
    encoding: 'utf8',
  });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(
    JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision,
    'deny',
  );
});

test('outside the repository: Codex is confined, Claude is not, and protected names apply either way', (t) => {
  const temp = realpathSync.native(mkdtempSync(join(tmpdir(), 'fw-hook-out-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const memory = join(temp, '.claude/projects/C--surah-framewright/memory');
  mkdirSync(memory, { recursive: true });
  const note = join(memory, 'note.md');
  assert.throws(() => checkedPath(note, root), /outside/);
  assert.equal(checkedPath(note, root, root, { confine: false }), note);
  for (const file of [
    join(temp, '.npmrc'),
    join(temp, '.claude/settings.json'),
    join(temp, 'other-repo/.env.local'),
  ]) {
    assert.throws(
      () => checkedPath(file, root, root, { confine: false }),
      /Protected/,
      file,
    );
  }
  const viaClaude = spawnSync(process.execPath, ['scripts/hook-protect.mjs'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: root,
      tool_name: 'Edit',
      tool_input: { file_path: note },
    }),
    encoding: 'utf8',
  });
  assert.equal(viaClaude.status, 0, viaClaude.stderr);
});

test('Claude wrappers share the handler: protect fails closed, and refuses the wrong event', () => {
  const blocked = spawnSync(process.execPath, ['scripts/hook-protect.mjs'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: root,
      tool_name: 'Write',
      tool_input: { file_path: join(root, '.ENV') },
    }),
    encoding: 'utf8',
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Protected/);
  const wrongEvent = spawnSync(process.execPath, ['scripts/hook-format.mjs'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'docs/a.md' },
    }),
    encoding: 'utf8',
  });
  assert.equal(wrongEvent.status, 2);
  assert.match(wrongEvent.stderr, /Expected a PostToolUse/);
});

test('configured launcher works from a subdirectory and returns session JSON', () => {
  const result = spawnSync(launcherCommand(), {
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

test('configured launcher fails closed when the handler cannot be found', (t) => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'fw-hook-launch-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const command = launcherCommand();
  const input = JSON.stringify(
    patch('*** Begin Patch\n*** Delete File: package-lock.json\n*** End Patch'),
  );
  const notARepo = spawnSync(command, {
    cwd: temp,
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    input,
  });
  assert.equal(notARepo.status, 2, notARepo.stderr);
  assert.match(notARepo.stderr, /hook launcher/);
  spawnSync('git', ['init', '-q', temp], { encoding: 'utf8' });
  const repoWithoutHandler = spawnSync(command, {
    cwd: temp,
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    input,
  });
  assert.equal(repoWithoutHandler.status, 2, repoWithoutHandler.stderr);
  assert.match(repoWithoutHandler.stderr, /hook launcher/);
});
