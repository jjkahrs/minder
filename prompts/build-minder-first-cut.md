# Task: Build the first cut of Minder

## Context
Minder is a local web app that gives live visibility into running Claude Code agents and subagents, plays customizable sounds on hook events, and renders a stylized visualization of each agent's state.

- Project root: `C:\dev\minder` (Windows 11). Currently contains only `CLAUDE.md` — read it first; it defines the color palette, typography, UI primitives, and motion rules you must follow. Not yet a git repo.
- Toolchain available: Node v24.21.0, npm 11.19.0.
- User-level Claude Code settings: `C:\Users\jjkah\.claude\settings.json`. It currently contains (among other keys: `env`, `permissions`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `autoMode`, ...) a `hooks.Stop` entry that runs PowerShell to play `C:\Users\jjkah\Documents\jobs-done_1.mp3`. Minder replaces that hook (see Scope). All other keys must be preserved byte-for-byte in meaning.
- User's global rules: test all changes and prove they meet acceptance criteria; never take control of the user's mouse or keyboard; if unsure about anything, ask rather than guess.

## Goal
Deliver a working, localhost-only Minder: Claude Code hooks send every relevant event to a local Node server, which keeps in-memory state of all sessions and their subagents and pushes updates to a React UI. The UI shows agents in two toggleable views (radar/constellation and tree list) with distinct visual states, a detail panel per agent, and a sound system with synthesized defaults, user-supplied audio files, and per-event toggles — all styled per `CLAUDE.md`.

## Scope
1. **Server** (Node + TypeScript)
   - Binds `127.0.0.1` only, port `4777`, overridable via env `MINDER_PORT`.
   - `npm start`: builds UI and serves UI + API + hook endpoint from one process. `npm run dev`: Vite HMR for UI plus server.
   - Endpoint receiving hook event JSON; real-time push to browser via SSE or WebSocket (your choice; prefer SSE if sufficient).
   - REST for sound config read/write and custom audio file upload/serve.
   - State is in-memory only. Restart = empty until new events arrive.
2. **Hook integration**
   - `npm run install-hooks`: merges Minder hook entries into `C:\Users\jjkah\.claude\settings.json` at user level. Must: write a timestamped backup first; be idempotent (running twice yields no duplicates); preserve all unrelated keys/hooks; **remove the existing jobs-done PowerShell `Stop` hook** (do not migrate the mp3).
   - `npm run uninstall-hooks`: removes only Minder entries (the jobs-done hook is not re-added unless restoring from backup; document how to restore the backup in README).
   - Transport: first check current official Claude Code hooks documentation. If native `type: "http"` hooks are supported, use them; otherwise use `type: "command"` running a small Node script (reads stdin JSON → POST to server). **Cite the doc URL/section you verified** in README and your final report.
   - Failure behavior: if the server is down, hooks must fail silently and fast (≤1s timeout), exit 0, never block, slow noticeably, or print errors into Claude Code.
   - Events handled: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` (and tool-failure event if Claude Code provides one, e.g. `PostToolUseFailure`), `SubagentStart`, `SubagentStop`, `Stop`, `Notification`. Verify exact event names and payload fields (session_id, agent ids, notification types, etc.) against docs; do not assume.
3. **State model** (pure, unit-tested reducer)
   - Sessions keyed by `session_id`; subagents nested under their parent session.
   - States, each visually distinct:
     - `THINKING` — after UserPromptSubmit / PostToolUse, no tool running.
     - `TOOL` — between PreToolUse and PostToolUse; shows tool name + short input summary.
     - `WAITING_PERMISSION` — permission-prompt Notification.
     - `WAITING_INPUT` — idle / awaiting user input Notification.
     - `ERROR` — tool failure; transient flash, then back to THINKING.
     - `IDLE` — after Stop (session) / SubagentStop (subagent).
     - `ENDED` — after SessionEnd; fades out and is removed.
     - `STALE` — no events for 10 min → dimmed; removed after 30 min.
   - Waiting states use Warning `#ff6e21` with pulse; they must be the most attention-grabbing.
4. **UI** (React + Vite + TypeScript; Framer Motion and/or CSS keyframes allowed)
   - **Radar/constellation view** (default): sessions as nodes on an off-center radar sweep; subagents orbit their parent.
   - **Tree list view**: corner-bracket-framed hierarchy sessions → subagents with state reticles.
   - Toggle between views; selection persists across toggle.
   - **Detail panel** (floating sub-panel) for selected session/subagent: short session id, cwd, agent type, current state + tool name/input summary, ticking time-in-state counter, subagent count, scrolling log of last 50 events.
   - Connection status indicator (server connected/disconnected, auto-reconnect).
5. **Sounds** (play in browser)
   - Built-in Web Audio synthesized default sound per event/state (no shipped audio assets).
   - User can pick a local audio file per event; uploaded to and stored in `data/sounds/`, served by server.
   - Config persisted in `data/config.json` via server REST.
   - Controls: master mute, master volume, per-event on/off, per-event volume, per-event sound choice (synth vs file), per-event "test" button.
   - Defaults: ON for `Stop`, `SubagentStop`, `WAITING_PERMISSION`, `WAITING_INPUT`, `ERROR`; OFF for all others.
   - Handle browser autoplay lock: show a clear "enable audio" affordance until the user interacts.
6. **Simulator**: `npm run simulate` replays a realistic fake event sequence (≥2 sessions, ≥1 with 2 subagents, covering every state including both waiting types and an error) against the running server.
7. **Repo**: `git init` in `C:\dev\minder`, `.gitignore` (node_modules, dist, `data/`), commit at the end of each phase with clear messages.
8. **README.md**: setup, install-hooks, uninstall-hooks, restoring settings backup, run (start/dev), simulate, sound customization, verified hook doc reference.

## Out of scope
- Controlling agents from the UI (no sending prompts, approving permissions, killing sessions). Read-only monitor.
- Remote / multi-machine access, auth, binding to non-localhost interfaces.
- Persisted event history, analytics, token/cost graphs.
- Transcript-file parsing/backfill.
- Packaging (Electron, installer, tray app), auto-starting the server from hooks.
- Server-side/OS sound playback.
- Modifying any part of `settings.json` other than Minder's hook entries and removing the jobs-done Stop hook.

## Constraints & conventions
- Follow `C:\dev\minder\CLAUDE.md` exactly: palette (`#0A0D14` bg, `#121824` surfaces, `#73fffe` primary accent/active, `#6287f8` secondary, `#383e65` structure, `#ff6e21` warning, `#e2f1f8` text); geometric/condensed/monospace fonts; all-caps wide-tracked headers/tags; corner-bracket frames instead of boxed borders; radial rings, reticles, ticking counters; animations < 200ms; asymmetric layered layout, not a card grid.
- TypeScript throughout. Vitest for tests. Keep dependencies minimal; no new deps beyond React, Vite, Framer Motion (optional), Vitest, and what the server strictly needs.
- Hook scripts must be Windows-compatible (paths with backslashes, PowerShell/cmd environment).
- Never let Minder break or slow Claude Code.
- Do not take control of the user's OS mouse/keyboard. Browser verification uses the Claude in Chrome extension only, in a **new tab you create**, interacting via the extension's in-tab tools.
- Avoid triggering browser alert/confirm dialogs.

## Acceptance criteria
- [ ] `npm install && npm start` serves the UI at `http://127.0.0.1:4777`; server not reachable on other interfaces.
- [ ] `MINDER_PORT=4800 npm start` serves on 4800.
- [ ] `npm run install-hooks` creates a timestamped backup of `settings.json`, adds Minder hooks for all listed events, removes the jobs-done Stop hook, leaves every other key intact; running it twice produces identical file content.
- [ ] `npm run uninstall-hooks` removes only Minder entries.
- [ ] With server stopped, invoking the hook (command script or equivalent) exits 0 within ~1s with no stderr output.
- [ ] `npm run simulate` makes sessions and subagents appear in both views, transitioning through THINKING, TOOL (with tool name), WAITING_PERMISSION, WAITING_INPUT, ERROR (transient), IDLE, ENDED (fade-out).
- [ ] STALE (10 min) and removal (30 min) logic proven by unit tests with fake timers.
- [ ] Subagents render nested/orbiting under the correct parent session.
- [ ] View toggle works and keeps selection; detail panel shows all listed fields, ticking time-in-state, and last 50 events (capped).
- [ ] Sound defaults match spec; master mute/volume, per-event toggle/volume/test work; uploading a custom file stores it in `data/sounds/`, persists in `data/config.json`, and survives server restart + page reload.
- [ ] A real Claude Code session (after install-hooks) shows up in Minder live.
- [ ] Visual style conforms to CLAUDE.md (palette, brackets, typography, motion < 200ms).
- [ ] `npm test` passes: reducer (all transitions incl. subagents, error transient, stale/removal), hook script (server-down behavior), install/uninstall merge (idempotency, preservation, jobs-done removal, backup).
- [ ] Git repo initialized with per-phase commits; README complete.

## Verification
1. `npm test` — show full passing output.
2. Install-merge proof: run install against a **copy** of `settings.json` first (script should accept a path arg/env for testing), diff before/after, run twice and show identical output; then run for real and show the diff + backup path.
3. Server-down proof: stop server, pipe sample event JSON into the hook command, show exit code 0 and elapsed time.
4. `npm start`, then `npm run simulate`. Using Claude in Chrome (new tab): screenshot radar view mid-simulation, tree view, detail panel open, a WAITING state, sound settings panel. Check console for errors via `read_console_messages`.
5. Sound config: via UI or REST, change settings + upload a test audio file; restart server, reload tab, show settings persisted and file present in `data/sounds/`.
6. Live check: run a short real Claude Code session (e.g. `claude -p "list files in this directory"`, ideally one that spawns a subagent) and show it appear in Minder.
7. Report each acceptance criterion with its evidence (command output or screenshot). State plainly any criterion not met.

## Open assumptions / questions
- Exact hook event names, payload fields (esp. how subagent events identify the subagent and parent, and Notification type values for permission vs idle input) and whether native `http` hooks exist must be verified against current Claude Code docs. If docs are ambiguous or a required field is missing (e.g. no way to distinguish permission vs input Notifications, or no subagent id), stop and ask the user rather than guess.
- If a real-session subagent can't be triggered reliably via `claude -p`, report that and rely on simulator evidence for subagent rendering; ask user whether to proceed.
- Font choice (e.g. via Google Fonts vs bundled) left to agent within CLAUDE.md guidance; if it requires a network font load and that's undesirable, ask.
