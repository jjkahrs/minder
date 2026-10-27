import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 47000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'minder-sessions-'));
let child: ChildProcess;

beforeAll(async () => {
  // Fake ~/.claude/sessions: this test process is a live pid; 2**30 is never a live pid; plus junk.
  const write = (name: string, body: string) => fs.writeFileSync(path.join(SESSIONS_DIR, name), body);
  write('1.json', JSON.stringify({ pid: process.pid, sessionId: 'pre-live', cwd: 'C:\dev\pre', status: 'shell' }));
  write('2.json', JSON.stringify({ pid: 2 ** 30, sessionId: 'pre-dead', status: 'busy' }));
  write('3.json', '{not json');
  write('4.key', 'ignored');
  child = spawn(process.execPath, ['server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, MINDER_PORT: String(PORT), MINDER_SESSIONS_DIR: SESSIONS_DIR },
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', (d) => String(d).includes('127.0.0.1') && resolve());
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});
afterAll(() => {
  child?.kill();
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
});

const post = (body: unknown) =>
  fetch(`${BASE}/hook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('server', () => {
  it('discovers sessions already running at startup from live session files only', async () => {
    const st = await (await fetch(`${BASE}/api/state`)).json();
    expect(st.sessions['pre-live']).toMatchObject({ state: 'SHELL', cwd: 'C:\dev\pre' });
    expect(st.sessions['pre-dead']).toBeUndefined();
  });

  it('honors MINDER_PORT and binds 127.0.0.1 only', async () => {
    expect((await fetch(`${BASE}/api/state`)).status).toBe(200);
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (external) {
      const reachable = await new Promise<boolean>((r) => {
        const s = net.connect(PORT, external, () => (s.destroy(), r(true)));
        s.on('error', () => r(false));
        s.setTimeout(1000, () => (s.destroy(), r(false)));
      });
      expect(reachable).toBe(false);
    }
  });

  it('ingests hook events and pushes snapshot + hook over SSE', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/stream`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    let buf = '';
    const until = async (needle: string) => {
      while (!buf.includes(needle)) buf += new TextDecoder().decode((await reader.read()).value);
    };
    await until('event: snapshot'); // initial snapshot on connect

    const r = await post({
      session_id: 'srv-test',
      hook_event_name: 'PreToolUse',
      cwd: 'C:\\x',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe(''); // http hooks: 2xx + empty body = success

    await until('event: hook');
    await until('"srv-test"');
    ctrl.abort();

    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.sessions['srv-test']).toMatchObject({ state: 'TOOL', cwd: 'C:\\x', tool: { name: 'Bash', summary: 'ls' } });
  });

  it('rejects malformed hook bodies and non-loopback Host headers', async () => {
    expect((await fetch(`${BASE}/hook`, { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await post({ hook_event_name: 'Stop' })).status).toBe(400);
    const status = await new Promise<number>((resolve) => {
      const s = net.connect(PORT, '127.0.0.1', () =>
        s.write(`GET /api/state HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`),
      );
      s.on('data', (d) => resolve(Number(String(d).split(' ')[1])));
    });
    expect(status).toBe(403);
  });
});
