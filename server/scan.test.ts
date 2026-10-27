import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.ts';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'minder-scan-'));
const write = (name: string, body: object) => fs.writeFileSync(path.join(DIR, name), JSON.stringify(body));
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  return cond();
};
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

describe('periodic session scan', () => {
  it('picks up new session files and ends sessions whose file disappears or whose pid dies', async () => {
    const app = await createApp({ tickMs: 60_000, scanMs: 30, sessionsDir: DIR });
    expect(app.getState().sessions).toEqual({});

    write('1.json', { pid: process.pid, sessionId: 'new', status: 'busy' });
    write('2.json', { pid: process.pid, sessionId: 'dies', status: 'idle' });
    expect(await until(() => !!app.getState().sessions.new && !!app.getState().sessions.dies)).toBe(true);
    expect(app.getState().sessions.new.state).toBe('THINKING');

    fs.rmSync(path.join(DIR, '1.json')); // file gone
    write('2.json', { pid: 2 ** 30, sessionId: 'dies', status: 'idle' }); // pid dead
    expect(await until(() => app.getState().sessions.new?.state === 'ENDED' && app.getState().sessions.dies?.state === 'ENDED')).toBe(true);
    expect(app.getState().sessions.new.log.at(-1)).toMatchObject({ event: 'SessionEnd', detail: 'process gone' });
    await app.close();
  });
});
