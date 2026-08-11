// PreToolUse hook — block edits to protected files.
// Reads the hook payload JSON on stdin; exit 2 blocks the edit with feedback.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const file = (payload?.tool_input?.file_path || '').replace(/\\/g, '/');
    const PROTECTED = [
      /(^|\/)package-lock\.json$/,
      /(^|\/)pnpm-lock\.yaml$/,
      /(^|\/)\.env(\.|$)/,
      /(^|\/)\.git\//,
    ];
    if (file && PROTECTED.some((re) => re.test(file))) {
      process.stderr.write(`Blocked: ${file} is a protected file (edit it manually).`);
      process.exit(2);
    }
  } catch {
    // fail open — never block on parse errors
  }
  process.exit(0);
});
