import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, reduce, seed, tick, type HookEvent, type MinderState, type SessionFile } from '../shared/state.ts';
import { defaultConfig, parseConfig, SAFE_FILE, type SoundConfig } from '../shared/sounds.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 5 * 1024 * 1024; // tool_input can carry whole file contents
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
// Accepted uploads: extension -> served content-type.
const AUDIO: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};
const MAX_SOUND = 10 * 1024 * 1024;

export interface MinderApp {
  server: http.Server;
  getState: () => MinderState;
  close: () => Promise<void>;
}

// SSE stream at GET /api/stream:
//   event: snapshot  data: MinderState               (on connect and after every change)
//   event: hook      data: { event: HookEvent-subset, state of target agent }  (after each ingested hook)
// Sound REST (data dir = MINDER_DATA_DIR or ./data, created on demand):
//   GET  /api/config                       -> SoundConfig (missing/corrupt file -> defaults)
//   PUT  /api/config  body SoundConfig      -> 200 saved config | 400
//   POST /api/sounds?name=<orig filename>   raw audio body -> 201 { file } | 400 | 413 | 415
//   GET  /api/sounds/<file>                 -> audio bytes | 404
export async function createApp({
  dev = false,
  tickMs = 1000,
  dataDir = process.env.MINDER_DATA_DIR || path.join(ROOT, 'data'),
  sessionsDir = process.env.MINDER_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions'),
} = {}): Promise<MinderApp> {
  const configFile = path.join(dataDir, 'config.json');
  const soundsDir = path.join(dataDir, 'sounds');
  const readConfig = (): SoundConfig => {
    try {
      return parseConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))) ?? defaultConfig();
    } catch {
      return defaultConfig();
    }
  };
  // Sessions already running at startup won't send hooks until they next do something; discover them once.
  let state = seed(emptyState(), readSessionFiles(sessionsDir), Date.now());
  const clients = new Set<http.ServerResponse>();
  const send = (res: http.ServerResponse, event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event: string, data: unknown) => clients.forEach((c) => send(c, event, data));

  const timer = setInterval(() => {
    const next = tick(state, Date.now());
    if (next !== state) {
      state = next;
      broadcast('snapshot', state);
    }
  }, tickMs);

  function ingest(ev: HookEvent) {
    state = reduce(state, ev, Date.now());
    const s = state.sessions[ev.session_id];
    const target = ev.agent_id ? (s?.subagents[ev.agent_id] ?? s) : s;
    broadcast('hook', {
      hook_event_name: ev.hook_event_name,
      session_id: ev.session_id,
      agent_id: ev.agent_id,
      notification_type: ev.notification_type,
      state: target?.state,
    });
    broadcast('snapshot', state);
  }

  let vite: import('vite').ViteDevServer | undefined;
  const server = http.createServer(async (req, res) => {
    // Reject DNS-rebinding requests: only loopback Host headers are served.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'POST' && url.pathname === '/hook') {
      // Claude Code http hooks treat a 2xx empty body as success; always answer fast with 204.
      const body = await readBody(req, res, MAX_BODY);
      if (!body) return;
      let ev: HookEvent;
      try {
        ev = JSON.parse(body.toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (typeof ev?.session_id !== 'string' || typeof ev.hook_event_name !== 'string') {
        res.writeHead(400).end();
        return;
      }
      ingest(ev);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      send(res, 'snapshot', state);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      json(res, 200, readConfig());
      return;
    }
    if (url.pathname === '/api/config' && req.method === 'PUT') {
      const body = await readBody(req, res, 64 * 1024);
      if (!body) return;
      let cfg: SoundConfig | null = null;
      try {
        cfg = parseConfig(JSON.parse(body.toString('utf8')));
      } catch {}
      if (!cfg) {
        res.writeHead(400).end();
        return;
      }
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(configFile + '.tmp', JSON.stringify(cfg, null, 2));
      fs.renameSync(configFile + '.tmp', configFile); // atomic-ish: never leave a half-written config
      json(res, 200, cfg);
      return;
    }

    if (url.pathname === '/api/sounds' && req.method === 'POST') {
      // Raw body upload (no multipart dep). The original name only contributes a sanitized stem + extension.
      const name = url.searchParams.get('name') ?? '';
      const ext = path.extname(name).toLowerCase();
      const type = String(req.headers['content-type'] ?? '');
      if (!AUDIO[ext] || !(type.startsWith('audio/') || type === 'application/octet-stream')) {
        res.writeHead(415).end();
        return;
      }
      const body = await readBody(req, res, MAX_SOUND);
      if (!body) return;
      if (body.length === 0) {
        res.writeHead(400).end();
        return;
      }
      const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'sound';
      const file = `${stem}-${Date.now().toString(36)}${ext}`;
      fs.mkdirSync(soundsDir, { recursive: true });
      fs.writeFileSync(path.join(soundsDir, file), body);
      json(res, 201, { file });
      return;
    }
    if (url.pathname.startsWith('/api/sounds/') && req.method === 'GET') {
      // Only server-generated basenames are servable, so no separators or '..' can get through.
      let file = '';
      try {
        file = decodeURIComponent(url.pathname.slice('/api/sounds/'.length));
      } catch {}
      const full = path.join(soundsDir, file);
      if (!SAFE_FILE.test(file) || !fs.existsSync(full)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': AUDIO[path.extname(file).toLowerCase()], 'cache-control': 'no-cache' });
      fs.createReadStream(full).pipe(res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    serveStatic(url.pathname, res);
  });

  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({
      root: ROOT,
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server } },
    });
  }

  return {
    server,
    getState: () => state,
    close: async () => {
      clearInterval(timer);
      clients.forEach((c) => c.end());
      await vite?.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const json = (res: http.ServerResponse, code: number, data: unknown) =>
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data));

// Buffers the request body; answers 413 and returns null once it exceeds max.
async function readBody(req: http.IncomingMessage, res: http.ServerResponse, max: number): Promise<Buffer | null> {
  if (Number(req.headers['content-length']) > max) {
    res.writeHead(413).end();
    req.resume(); // drain so the client gets the 413 instead of a reset
    return null;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  // Keep reading (discarding) past the cap: returning from for-await would destroy the socket.
  for await (const c of req) {
    size += c.length;
    if (size <= max) chunks.push(c);
  }
  if (size > max) {
    res.writeHead(413).end();
    return null;
  }
  return Buffer.concat(chunks);
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  let file = path.join(DIST, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // SPA fallback
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('UI not built. Run `npm start` (or `npm run build`).');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Reads Claude Code's per-process session files (~/.claude/sessions/<pid>.json), keeping live processes only.
// Undocumented format (see README): anything unreadable or unexpected is skipped silently.
export function readSessionFiles(dir: string): SessionFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const n of names) {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (typeof f?.sessionId !== 'string' || !Number.isInteger(f.pid) || !alive(f.pid)) continue;
      out.push({
        sessionId: f.sessionId,
        cwd: typeof f.cwd === 'string' ? f.cwd : undefined,
        status: typeof f.status === 'string' ? f.status : undefined,
        statusUpdatedAt: typeof f.statusUpdatedAt === 'number' ? f.statusUpdatedAt : undefined,
      });
    } catch {}
  }
  return out;
}

// ponytail: pid check only; a reused pid after a crash could resurrect a dead session until it goes STALE.
// Compare the file's procStart to the process start time if that ever matters.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
