// Single source of the "which files may an agent not touch" rule.
// Claude hooks (hook-protect/hook-format), the Codex adapter (codex-hooks) and
// the shell guard (harness.config.mjs) all import from here so the rule cannot
// drift between agents.
import { realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Protected names, matched against a repository-relative path (one segment or
// a trailing path). `{sep}` marks a directory separator: `/` once the path is
// normalized, either slash inside a raw shell command. `NAME` is one segment's
// worth of characters that cannot be a separator or a shell delimiter.
const NAME = '[^\\\\/\\s"\'&|;>]';
const NAMES = [
  'package-lock\\.json',
  'pnpm-lock\\.yaml',
  `\\.env(?:\\.${NAME}*)?`, // .env, .env.local, .env.production ...
  '\\.envrc',
  '\\.npmrc', // registry auth tokens
  // Private keys. The name has to start where a path starts — right after a
  // separator, or at the start of what is being judged — so that `.key`/`.pem`
  // hanging off an identifier in a code string (`entry.key`, `obj.pem` inside a
  // sed script) is read as the property access it is, not as a key file.
  // Known limitation, accepted: a bare key name with no directory in front of
  // it (`rm server.pem`, `cp a.key b`, `mv id_rsa.key /tmp/x`) is no longer
  // caught by the shell guard. In a command string the `a.key` of `cp a.key b`
  // and the `entry.key` of `return entry.key` are the same token with the same
  // boundaries either side, so no name pattern can separate them; separating
  // them needs context — is this an argument position outside quotes? — which
  // lives in the gap between the command and its argument in SHELL_WRITE_RE and
  // would move the shell verdict for every protected name at once, so it was
  // left alone. The edit hook still refuses `server.key` by name: the hole is
  // on the shell path only.
  `(?<![^\\\\/])${NAME}*\\.(?:pem|key)`,
  '\\.git', // directory, or the file a worktree keeps in its place
  '\\.claude{sep}settings(?:\\.local)?\\.json', // the hooks themselves
  '\\.codex{sep}(?:hooks\\.json|config\\.toml)',
  '\\.prettierrc\\.[cm]?[jt]s', // executed by the format hook
  'prettier\\.config\\.[cm]?[jt]s',
];
const alternation = (sep) =>
  NAMES.map((n) => n.replaceAll('{sep}', sep)).join('|');

// A protected name must be a whole path segment: `.gitignore`, `.github` and
// `.environment` are not protected, `.git/config` and `.env.local` are.
export const PROTECTED_PATH_RE = new RegExp(
  `(^|/)(?:${alternation('/')})(?:/|$)`,
  'i',
);

// Shell commands that write, move or delete a protected file. Deliberately a
// coarse net over direct file operations; `npm install` rewriting the
// lockfile is the legitimate route and is not matched.
const SHELL_NAMES = [alternation('[\\\\/]')];
const PROTECTED_ARG = `(?:^|[\\s"'=]|[\\\\/])(?:${SHELL_NAMES.join('|')})(?=$|[\\s"'\\\\/;&|>)])`;
const WRITE_CMD =
  '(?:rm|del|erase|rd|rmdir|mv|move|ren|rename|cp|copy|tee|truncate|shred|unlink' +
  '|Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item' +
  '|ri|rni|mi|sc|ac' +
  '|sed\\s+-[a-zA-Z]*i|perl\\s+-[a-zA-Z]*i|apply_patch' +
  '|git\\s+(?:rm|mv|checkout|restore))';
export const SHELL_WRITE_RE = new RegExp(
  `(?:^|[;&|(]\\s*)${WRITE_CMD}\\b[^;&|]*${PROTECTED_ARG}` +
    `|>{1,2}\\s*["']?(?:[^\\s;&|"'>]*[\\\\/])?(?:${SHELL_NAMES.join('|')})(?=$|[\\s"'\\\\/;&|>)])`,
  'im',
);

export const SHELL_WRITE_RULE = {
  id: 'no-protected-file-write',
  pattern: SHELL_WRITE_RE,
  why: 'Lockfiles, .env, keys, .git and the hook configuration are protected from agent edits; a shell command must not be the way around the edit hook.',
  recover:
    'Leave the file for the owner to change. Lockfiles change through the package manager, not by hand.',
};

// Claude: Edit/Write/MultiEdit use file_path, NotebookEdit uses notebook_path.
// Codex: apply_patch puts the whole patch in command, including several files
// and rename destinations.
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
  const file =
    payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
  if (typeof file !== 'string' || !file)
    throw new Error('Missing edit file_path.');
  return [file];
}

// Resolve existing parents too: a new file may be inside a symlink/junction.
// `native` also expands Windows 8.3 short names (PACKAG~2.JSO).
function physicalPath(file) {
  if (existsSync(file)) return realpathSync.native(file);
  const parent = dirname(file);
  return parent === file
    ? file
    : join(physicalPath(parent), relative(parent, file));
}

// Win32 silently maps `name.` and `name ` onto `name`, and `name:stream` onto
// an alternate data stream of `name`; none of these spellings can be matched
// by name, so they are refused outright.
function rejectHostileSegments(rel) {
  if (process.platform !== 'win32') return;
  for (const segment of rel.split('/')) {
    if (/[. ]$/.test(segment) || segment.includes(':')) {
      throw new Error(`Edit target has a Windows-ambiguous name: ${segment}`);
    }
  }
}

// `confine` keeps every edit inside the repository. Codex works with
// cwd-relative patch paths, so a `../` or junction escape is refused there.
// Claude legitimately writes outside the repository (its memory directory,
// job scratch space, a paired repository), so its hooks pass confine:false;
// the protected-name rule still applies to the full path, so ~/.npmrc or
// ~/.claude/settings.json stay off limits.
export function checkedPath(
  file,
  cwd,
  workspace = root,
  { confine = true } = {},
) {
  const base = realpathSync.native(workspace);
  const absolute = resolve(cwd, file);
  for (const candidate of [absolute, physicalPath(absolute)]) {
    const rel = relative(base, candidate).split(sep).join('/');
    const outside = isAbsolute(rel) || rel === '..' || rel.startsWith('../');
    if (outside && confine) {
      throw new Error('Edit target is outside this repository.');
    }
    // Outside the repository there is no base to be relative to; judge the
    // whole path, minus the drive letter that would trip the `:` check.
    const judged = outside
      ? candidate
          .split(sep)
          .join('/')
          .replace(/^[A-Za-z]:/, '')
      : rel;
    rejectHostileSegments(judged);
    if (PROTECTED_PATH_RE.test(judged)) {
      throw new Error(`Protected edit target: ${judged}`);
    }
  }
  return absolute;
}

// Codex and Claude both hand shell commands over as tool_input.command; keep
// the array form (["bash","-lc","..."]) working too.
export function shellCommand(payload) {
  const command = payload.tool_input?.command;
  if (!Array.isArray(command)) return String(command ?? '');
  // ["bash", "-lc", "<script>"]: the script is what runs, so match on it.
  const script = command.findIndex((arg) => /^-l?c$/.test(String(arg)));
  return script >= 0 && script < command.length - 1
    ? String(command[script + 1])
    : command.map(String).join(' ');
}

export function shellDenial(payload) {
  const command = shellCommand(payload);
  if (!SHELL_WRITE_RE.test(command)) return null;
  return `${SHELL_WRITE_RULE.why} ${SHELL_WRITE_RULE.recover}`;
}
