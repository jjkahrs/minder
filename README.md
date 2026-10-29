# Minder

Local, read-only monitor for running Claude Code agents and subagents. Claude Code hooks forward every
relevant event to a small Node server on `127.0.0.1`, which keeps in-memory state and pushes it over SSE
to a React UI (LCARS-style display + compact tree view, detail panel, synthesized or custom sounds).

## Setup

Requires Node 24+ (the server and hook scripts run TypeScript directly; no build step for them).

```sh
npm install
npm start            # builds the UI, serves UI + API + hook endpoint at http://127.0.0.1:4777
npm run dev          # Vite HMR for the UI plus the server (restarts on server/shared changes)
```

- `MINDER_PORT` overrides the port (`MINDER_PORT=4800 npm start`). The server binds `127.0.0.1` only.
- `MINDER_DATA_DIR` overrides where sound config and uploads live (default `./data`).
- `MINDER_SESSIONS_DIR` overrides where Claude Code's session files are read from (default `~/.claude/sessions`).
- State is in memory only. The server discovers running sessions from Claude Code's session files at startup
  and every 5 s after (see [Session discovery](#session-discovery)); everything else comes from hooks.

## Hooks

```sh
npm run install-hooks                      # edits ~/.claude/settings.json
npm run install-hooks -- <path/to/settings.json>   # or MINDER_SETTINGS_PATH=<path>
npm run uninstall-hooks [-- <path>]
```

Install:
- Writes a backup next to the file first: `settings.json.minder-backup-<timestamp>` (every run, install or uninstall).
- Adds one command hook per event: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
  `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `Notification`.
  Each runs `node <repo>\hooks\minder-hook.ts <port>`.
- **The port is fixed at install time** (`MINDER_PORT` when you run install, default 4777). If you change
  the server port, re-run install with the same `MINDER_PORT`.
- Removes the old jobs-done PowerShell `Stop` hook (the one playing `jobs-done_1.mp3`). It is not migrated.
- Idempotent: running it twice produces byte-identical output. All other keys and hooks are preserved.

Uninstall removes only Minder's entries (and the `hooks` key if it ends up empty). It does **not** re-add
the jobs-done hook.

**Restoring a backup:** pick the backup you want (the one from your first install has the original
jobs-done hook) and copy it over `settings.json`:

```powershell
Copy-Item "$HOME\.claude\settings.json.minder-backup-<timestamp>" "$HOME\.claude\settings.json"
```

### Failure behavior

If Minder isn't running, the hook script gives up within ~1s (900 ms request abort, 1 s hard exit; with
nothing listening it fails immediately), prints nothing, and always exits 0, so Claude Code is never
blocked or shown an error.

### Hook doc references (verified)

From https://code.claude.com/docs/en/hooks:
- [#exit-code-output](https://code.claude.com/docs/en/hooks#exit-code-output) — exit 0 with no output is a no-op success.
- [#http-response-handling](https://code.claude.com/docs/en/hooks#http-response-handling) — native `type: "http"` hooks exist,
  but a connection failure is reported as a non-blocking error, which Claude Code surfaces as a
  "Stop hook error" notice when the server is down. That's why Minder uses `type: "command"` with a
  tiny forwarder script that swallows failures instead.
- [#sessionend-input](https://code.claude.com/docs/en/hooks#sessionend-input) — SessionEnd payload (`reason`).
- [#run-hooks-in-the-background](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background) — considered;
  hooks are kept synchronous (bounded at ~1 s) so events arrive in order.

## Simulator

```sh
npm start                 # in one terminal
npm run simulate          # in another (honours MINDER_PORT)
```

Replays ~50 s of realistic fake hook payloads: two sessions, one spawning two subagents (`Explore`,
`general-purpose`), covering THINKING, TOOL (Read/Bash/Edit/Grep/Glob/Write/Agent), WAITING_PERMISSION
(`permission_prompt`), WAITING_INPUT (`idle_prompt`), ERROR (`PostToolUseFailure`, session and subagent),
IDLE (`Stop`/`SubagentStop`) and ENDED (`SessionEnd`). Exits 1 with a clear message if the server is down.

## States

| State | Trigger | Look |
|---|---|---|
| THINKING | UserPromptSubmit, PostToolUse, SubagentStart | blue, spinning reticle |
| TOOL | PreToolUse (until PostToolUse) | cyan, tool name + input summary |
| AWAIT PERMISSION | Notification `permission_prompt` | orange `#ff6e21`, pulsing, alert banner |
| AWAIT INPUT | Notification `idle_prompt` / elicitation dialogs | orange `#ff6e21`, pulsing, alert banner |
| ERROR | PostToolUseFailure | orange cross, 1.5 s flash, then THINKING |
| IDLE | Stop (session), SubagentStop (subagent) | dim ring |
| SHELL | startup discovery only: session file `status: "shell"` | blue, still reticle |
| ENDED | SessionEnd, or its session file/process is gone (detail `process gone`) | fades out, removed after 3 s |
| STALE | no events for 10 min | dimmed; removed after 30 min |

## Session discovery

Sessions that were running before Minder started don't send hooks until they next do something, and a crashed
or killed process never sends `SessionEnd`. So the server reads Claude Code's per-process session files **at
startup and every 5 s**:
- A live session it doesn't know yet is added. Hook events then take over as usual; the file's status is only
  used for that first state.
- A session that was seen in a file but whose file is now gone or whose process is dead gets a synthetic
  `SessionEnd` (reason `process gone`): same ENDED fade, log entry and SessionEnd sound as a real one.
- Sessions only ever seen through hooks (no file) are never ended this way; they follow normal STALE timing.
  That way a file-format change can't wipe every session.

Subagents are not discoverable this way; they appear when they next fire a hook and end with their session.
Discovered sessions follow normal timing (STALE after 10 min of no hooks, removed after 30 min).

**This file format is undocumented by Claude Code** and was observed on Windows with versions 2.1.309–2.1.311.
It may change without notice; Minder skips any file it can't read or that lacks the fields below, so a
format change means discovery quietly stops, nothing else breaks.

`~/.claude/sessions/<pid>.json` (one per running Claude Code process; a `<pid>.<hash>.key` file sits
next to each and is ignored). Observed example; the commented fields are the ones Minder uses:

```jsonc
{
  "pid": 57264,                                   // process id; files whose process is gone are skipped
  "sessionId": "d2eced42-f996-4922-99eb-64e00cbd2885", // matches hook session_id
  "cwd": "C:\\dev\\kast",                       // working directory
  "status": "idle",                               // busy -> THINKING, idle -> IDLE, shell -> SHELL, other -> IDLE
  "statusUpdatedAt": 1793114468911,               // ms epoch; becomes the state's start time
  "startedAt": 1793105991933,
  "procStart": "134375795909376131",
  "version": "2.1.311",
  "kind": "interactive",
  "entrypoint": "cli",
  "name": "kast-ce",
  "nameSource": "derived",
  "updatedAt": 1793114468911,
  "peerProtocol": 1, "peerFeatures": ["notify_idle", "artifact_yield"],
  "pidDomain": "win32:...", "messagingSocketPath": "\\\\.\\pipe\\LOCAL\\cc-msg-...", "nameSince": 1793105991933
}
```

The meaning of `status: "shell"` isn't documented (it may mean a shell command is running), so it gets its
own SHELL label rather than a guessed state. Liveness is a plain pid check, so a reused pid could briefly
resurrect a crashed session until it goes STALE.

## Sounds

Open **SOUND CFG** at the bottom-left. Browsers block audio until you interact with the page; until then
an **ENABLE AUDIO** button is shown — click it (any click on the page also works).

- Master: mute and volume.
- Per key: on/off, volume, source (synth or uploaded file), TEST (always plays, even when muted/off).
- Defaults ON: `Stop`, `SubagentStop`, `WAITING_PERMISSION`, `WAITING_INPUT`, `ERROR`; all others OFF.
- Mapping (one sound per event): `Notification` plays `WAITING_PERMISSION`/`WAITING_INPUT` when it puts the
  agent in that state, otherwise `Notification`; `PostToolUseFailure` plays `ERROR`; every other event plays
  the key with its own name.
- Uploads: audio files only (wav, mp3, ogg/opus, m4a, aac, flac, webm), up to 10 MB. Stored in
  `data/sounds/` (or `$MINDER_DATA_DIR/sounds/`); config in `data/config.json`. Both survive restarts.
  Replacing a key's file does not delete the old upload; clean `data/sounds/` by hand if you like.

## Notes

- Dark Reader: `index.html` carries a `darkreader-lock` meta so the extension leaves the palette alone.
- Tests: `npm test` (Vitest). Typecheck: `npm run typecheck`.

## Out of scope

Controlling agents (no prompts/approvals/kills — read-only), remote or multi-machine access and auth,
persisted event history/analytics/cost graphs, transcript parsing/backfill, packaging or auto-starting the
server from hooks, server-side/OS sound playback.
