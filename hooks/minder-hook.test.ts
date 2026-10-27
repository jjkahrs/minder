import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'minder-hook.ts');
const event = { session_id: 'hook-test', hook_event_name: 'UserPromptSubmit', cwd: 'C:\\dev', prompt: 'hi ✓' };

function runHook(port: number) {
  return new Promise<{ code: number | null; ms: number; stdout: string; stderr: string }>((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [SCRIPT, String(port)]);
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, ms: Date.now() - start, stdout, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => r(port));
    });
  });

describe('minder-hook script', () => {
  it('server down: exits 0 fast with no output', async () => {
    const r = await runHook(await freePort());
    expect(r).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(r.ms).toBeLessThan(1500);
  });

  it('server hanging: gives up within ~1s', async () => {
    const hang = net.createServer(() => {}).listen(0, '127.0.0.1');
    await new Promise((r) => hang.once('listening', r));
    const r = await runHook((hang.address() as net.AddressInfo).port);
    hang.close();
    expect(r).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(r.ms).toBeLessThan(1500);
  });

  it('server up: delivers the event', async () => {
    const app = await createApp({ tickMs: 60_000 });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const r = await runHook((app.server.address() as net.AddressInfo).port);
    const session = app.getState().sessions['hook-test'];
    await app.close();
    expect(r).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(session).toMatchObject({ cwd: 'C:\\dev', state: 'THINKING' });
  });
});
