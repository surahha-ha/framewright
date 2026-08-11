// PostToolUse hook — format just the file that was edited (Prettier).
// Reads the hook payload JSON on stdin, formats the changed file, exits 0.
// Cross-platform (node + npx), so it works on Windows too.
import { execSync } from 'node:child_process';

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const file = payload?.tool_input?.file_path;
    if (file && /\.(ts|tsx|css|json|md|html)$/.test(file)) {
      execSync(`npx prettier --write "${file}"`, { stdio: 'ignore' });
    }
  } catch {
    // never block on formatting problems
  }
  process.exit(0);
});
