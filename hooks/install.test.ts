import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENTS, run } from './install.ts';

// Shape copied from the real ~/.claude/settings.json, plus an unrelated hook that must survive.
const jobsDone = {
  type: 'command',
  command: 'powershell',
  args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    "Add-Type -AssemblyName presentationCore; $p=New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'C:\\Users\\jjkah\\Documents\\jobs-done_1.mp3'); $p.Play(); Start-Sleep -Seconds 5"],
  async: true,
};
const unrelated = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] };
const fixture = {
  env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
  permissions: { allow: ['Bash(powershell *)'] },
  statusLine: { type: 'command', command: 'powershell -ExecutionPolicy Bypass -File "C:\\Users\\jjkah\\.claude\\hooks\\statusline-context.ps1"' },
  enabledPlugins: { 'caveman@caveman': true },
  autoMode: { environment: ['**Internal sharing**: None configured — treat as outside'] },
  hooks: { Stop: [{ hooks: [jobsDone] }], PreToolUse: [unrelated] },
};

let dir: string, file: string;
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const backups = () => fs.readdirSync(dir).filter((f) => f.includes('.minder-backup-'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minder-'));
  file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
});

describe('install-hooks', () => {
  it('adds every event, removes jobs-done, preserves unrelated keys and hooks, backs up', () => {
    const { backup } = run([file], { MINDER_PORT: '4800' });
    const s = read();
    for (const event of EVENTS) {
      const minder = s.hooks[event].flatMap((g: any) => g.hooks).filter((h: any) => JSON.stringify(h).includes('minder-hook.ts'));
      expect(minder).toHaveLength(1);
      expect(minder[0]).toMatchObject({ type: 'command', command: 'node', timeout: 2 });
      expect(minder[0].args[1]).toBe('4800');
    }
    expect(JSON.stringify(s)).not.toContain('jobs-done');
    expect(s.hooks.Stop).toHaveLength(1);
    expect(s.hooks.PreToolUse[0]).toEqual(unrelated);
    const { hooks, ...rest } = s;
    const { hooks: _, ...fixtureRest } = fixture;
    expect(rest).toEqual(fixtureRest);
    expect(fs.readFileSync(backup, 'utf8')).toBe(JSON.stringify(fixture, null, 2));
  });

  it('is idempotent: second run is byte-identical and makes another backup', () => {
    run([file], {});
    const first = fs.readFileSync(file, 'utf8');
    run([file], {});
    expect(fs.readFileSync(file, 'utf8')).toBe(first);
    expect(backups()).toHaveLength(2);
  });

  it('honors MINDER_SETTINGS_PATH and defaults the port to 4777', () => {
    run([], { MINDER_SETTINGS_PATH: file });
    expect(read().hooks.Stop[0].hooks[0].args[1]).toBe('4777');
  });
});

describe('uninstall-hooks', () => {
  it('removes only Minder entries and does not restore jobs-done', () => {
    run([file], {});
    run(['--uninstall', file], {});
    const { hooks, ...rest } = read();
    const { hooks: _, ...fixtureRest } = fixture;
    expect(hooks).toEqual({ PreToolUse: [unrelated] });
    expect(rest).toEqual(fixtureRest);
  });

  it('keeps non-Minder handlers that share a group with a Minder handler', () => {
    run([file], {});
    const s = read();
    s.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo mine' });
    fs.writeFileSync(file, JSON.stringify(s));
    run(['--uninstall', file], {});
    expect(read().hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'echo mine' }] }]);
  });
});
