// Merges Minder hooks into Claude Code user settings (or removes them with --uninstall).
// Usage: node hooks/install.ts [--uninstall] [settingsPath]
//   settingsPath defaults to $MINDER_SETTINGS_PATH, then ~/.claude/settings.json. Port: $MINDER_PORT || 4777.
//
// Transport: `type: "command"` running minder-hook.ts, not native `type: "http"`.
// Per https://code.claude.com/docs/en/hooks#http-response-handling a connection failure is a
// "non-blocking error", and non-blocking errors show a "<hook name> hook error" notice in the
// transcript (#exit-code-output). With the server down that would print errors into Claude Code
// (verified: `claude -p` with an http hook on a dead port emits "Stop hook error occurred · ctrl+o to see").
// A command hook that exits 0 with no output is silent (stdout/stderr go to the debug log only).
// Not `async: true`: each async hook is a separate background process, so PreToolUse/PostToolUse
// could arrive out of order; the sync script costs ~60ms and is capped at 1s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'Notification',
];
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'minder-hook.ts');

type Handler = Record<string, unknown>;
type Group = { matcher?: string; hooks?: Handler[] } & Record<string, unknown>;
type Settings = { hooks?: Record<string, Group[]> } & Record<string, unknown>;

const isMinder = (h: Handler) => JSON.stringify(h).includes('minder-hook.ts');
const isJobsDone = (h: Handler) => /jobs-done_1\.mp3/i.test(JSON.stringify(h));

// Removes handlers matching `drop`, then any groups/events/hooks object left empty.
function strip(settings: Settings, drop: (h: Handler) => boolean) {
  if (!settings.hooks) return;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = groups
      .map((g) => (g.hooks ? { ...g, hooks: g.hooks.filter((h) => !drop(h)) } : g))
      .filter((g) => !g.hooks || g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
}

export function install(settings: Settings, port: string | number): Settings {
  strip(settings, (h) => isMinder(h) || isJobsDone(h));
  settings.hooks ??= {};
  const handler = { type: 'command', command: 'node', args: [SCRIPT, String(port)], timeout: 2 };
  for (const event of EVENTS) (settings.hooks[event] ??= []).push({ hooks: [handler] });
  return settings;
}

export function uninstall(settings: Settings): Settings {
  strip(settings, isMinder);
  return settings;
}

export function run(argv: string[], env = process.env) {
  const remove = argv.includes('--uninstall');
  const file =
    argv.find((a) => !a.startsWith('--')) ||
    env.MINDER_SETTINGS_PATH ||
    path.join(os.homedir(), '.claude', 'settings.json');
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
  const settings = JSON.parse(original);
  const next = remove ? uninstall(settings) : install(settings, env.MINDER_PORT || 4777);
  let backup = '';
  if (fs.existsSync(file)) {
    backup = `${file}.minder-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return { file, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, backup } = run(process.argv.slice(2));
  console.log(`${process.argv.includes('--uninstall') ? 'Removed Minder hooks from' : 'Installed Minder hooks into'} ${file}`);
  if (backup) console.log(`Backup: ${backup}`);
}
