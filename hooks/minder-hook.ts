// Claude Code hook handler: forwards the hook's stdin JSON to the Minder server.
// Must never affect Claude Code: no stdout (it becomes model context on SessionStart/UserPromptSubmit),
// no stderr, always exit 0, and give up after 1s if the server is down or slow.
// Usage: node minder-hook.ts [port]
setTimeout(() => process.exit(0), 1000);
const port = process.argv[2] || process.env.MINDER_PORT || '4777';

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(900),
  });
} catch {
  // server down / timeout: silently drop the event
}
process.exit(0);
