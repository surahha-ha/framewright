// framewright — structural checks for things a green test suite will not tell
// you, and that are cheap to get exactly right without a type-checker.
//
// Real bugs that shipped from this gap while restructuring the UI:
//   * the same symbol imported twice → build failure + Vite error overlay,
//     which made every e2e assertion fail for an unrelated-looking reason;
//   * an import left pointing at a file that had been renamed.
//
// Use-before-declaration (the other bug we shipped) is deliberately NOT checked
// here: `tsc` already reports it precisely (TS2448), and a naive scope model
// produced false positives on object-literal shorthand. Run `npm run typecheck`.
//
// Runs on every edit (PostToolUse hook) and via `npm run check:refs`.
// Exit 2 => blocking, with the reason on stderr.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const ROOTS = ['src', 'e2e'];
const EXTS = ['.ts', '.tsx'];
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

function report(file, node, source, message) {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  problems.push(`${file}:${line + 1}: ${message}`);
}

/** Same symbol imported more than once in one file. */
function checkDuplicateImports(file, source) {
  const seen = new Map();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const names = [];
    if (stmt.importClause.name) names.push(stmt.importClause.name.text);
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) names.push(el.name.text);
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      names.push(bindings.name.text);
    }
    for (const n of names) {
      if (seen.has(n)) {
        report(file, stmt, source, `duplicate import of "${n}"`);
      } else {
        seen.set(n, stmt);
      }
    }
  }
}

/** Relative import that points at a file which does not exist. */
function checkUnresolvedImports(file, source) {
  const base = dirname(file);
  const check = (spec, node) => {
    if (!spec.startsWith('.')) return;
    const target = resolve(base, spec);
    const candidates = [
      target,
      ...EXTS.map((e) => target + e),
      ...EXTS.map((e) => join(target, 'index' + e)),
      target + '.js',
      target + '.css',
    ];
    if (!candidates.some((c) => existsSync(c))) {
      report(file, node, source, `import target not found: "${spec}"`);
    }
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      check(node.moduleSpecifier.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    checkDuplicateImports(file, source);
    checkUnresolvedImports(file, source);
  }
}

if (problems.length) {
  process.stderr.write(
    'framewright reference check failed:\n- ' + problems.join('\n- ') + '\n',
  );
  process.exit(2);
}
process.exit(0);
