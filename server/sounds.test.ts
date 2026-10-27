import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp, type MinderApp } from './app.ts';
import { defaultConfig } from '../shared/sounds.ts';

let dir: string;
let app: MinderApp;
let base: string;

async function start() {
  app = await createApp({ dataDir: dir });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minder-data-'));
  await start();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (body: string) => fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
const upload = (name: string, body: Buffer, type = 'audio/wav') =>
  fetch(`${base}/api/sounds?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(body) });
// fetch normalizes '..' out of URLs, so send raw paths with http.get.
const rawGet = (p: string, host = '127.0.0.1') =>
  new Promise<number>((r) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: p, headers: { host } }, (res) => (res.resume(), r(res.statusCode!)));
  });

describe('sound config REST', () => {
  it('GET returns defaults when no config file exists (and does not create one)', async () => {
    expect(await (await fetch(`${base}/api/config`)).json()).toEqual(defaultConfig());
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
  });

  it('corrupted config file falls back to defaults', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
    expect(await (await fetch(`${base}/api/config`)).json()).toEqual(defaultConfig());
  });

  it('PUT persists to data/config.json and survives a server restart', async () => {
    const c = defaultConfig();
    c.muted = true;
    c.volume = 0.3;
    c.sounds.PreToolUse.enabled = true;
    c.sounds.Stop.volume = 0.25;
    expect((await put(JSON.stringify(c))).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))).toEqual(c);
    await app.close();
    await start();
    expect(await (await fetch(`${base}/api/config`)).json()).toEqual(c);
  });

  it('PUT rejects invalid input without touching the file', async () => {
    expect((await put('nope')).status).toBe(400);
    expect((await put(JSON.stringify({ ...defaultConfig(), volume: 'loud' }))).status).toBe(400);
    const c = defaultConfig() as any;
    c.sounds.Stop = { enabled: true, volume: 1, source: 'file', file: '../../evil.wav' };
    expect((await put(JSON.stringify(c))).status).toBe(400);
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
  });

  it('rejects non-loopback Host', async () => {
    expect(await rawGet('/api/config', 'evil.example')).toBe(403);
  });
});

describe('sound upload', () => {
  const wav = Buffer.from('RIFF....WAVEfmt fake-audio-bytes');

  it('stores the file in data/sounds and serves it back', async () => {
    const r = await upload('My Ding!.wav', wav);
    expect(r.status).toBe(201);
    const { file } = await r.json();
    expect(file).toMatch(/^My_Ding_-[a-z0-9]+\.wav$/);
    expect(fs.readFileSync(path.join(dir, 'sounds', file))).toEqual(wav);
    const g = await fetch(`${base}/api/sounds/${file}`);
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await g.arrayBuffer())).toEqual(wav);
  });

  it('upload name cannot escape data/sounds', async () => {
    const { file } = await (await upload('..\\..\\..\\evil.wav', wav)).json();
    expect(file).not.toMatch(/[\\/]|\.\./);
    expect(fs.existsSync(path.join(dir, 'sounds', file))).toBe(true);
  });

  it('rejects non-audio types, empty bodies and oversize files', async () => {
    expect((await upload('x.exe', wav, 'application/octet-stream')).status).toBe(415);
    expect((await upload('x.wav', wav, 'text/html')).status).toBe(415);
    expect((await upload('x.wav', Buffer.alloc(0))).status).toBe(400);
    expect((await upload('big.wav', Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect(fs.existsSync(path.join(dir, 'sounds'))).toBe(false);
  });

  it('serve rejects traversal and unknown files', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{}');
    expect(await rawGet('/api/sounds/..%2fconfig.json')).toBe(404);
    expect(await rawGet('/api/sounds/..%5cconfig.json')).toBe(404);
    expect(await rawGet('/api/sounds/%2e%2e%5c%2e%2e%5cpackage.json')).toBe(404);
    expect(await rawGet('/api/sounds/missing-1.wav')).toBe(404);
  });
});
