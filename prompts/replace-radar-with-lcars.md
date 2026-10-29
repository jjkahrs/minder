# Task: Replace the radar view with an LCARS display and restyle Minder in LCARS idiom

## Context
Minder (`C:\dev\minder`) is a localhost web app showing live Claude Code sessions and subagents. Node server (`server/`) receives hook events, keeps state (`shared/state.ts`), streams snapshots over SSE to a React 19 + Vite UI (`src/`). Read `CLAUDE.md` (palette, typography, motion rules) and `README.md` first.

Current UI:
- `src/App.tsx` — toggles `view: 'radar' | 'tree'` (radar default); renders HUD header (title, SESSIONS/AGENTS counts, view toggle), link status, `Sounds` panel, waiting-agent alert, `Detail` panel for the selected agent.
- `src/Radar.tsx` — SVG off-center radar with rotating sweep; sessions placed by `sessionPos`, subagents orbit via `orbitPos`/`orbitRadius` (all in `src/ui.ts`, tested in `src/ui.test.ts`).
- `src/Tree.tsx` — list view: per-session section (uses `.brackets`), one row per agent: `Glyph`, name, `STATE_LABEL`, tool name+summary, `formatDuration(now - stateSince)`.
- `src/Glyph.tsx` — state reticle SVG, shared; color/animation from `st-<STATE>` classes in `src/styles.css`.
- `src/Detail.tsx`, `src/Sounds.tsx` — floating panels, both use `.brackets`.
- `src/styles.css` — palette tokens on `:root` (`--bg --surface --accent --accent2 --structure --warn --text`), fonts `--font-head` / `--font-mono` (system fonts today), `.brackets` corner-bracket helper, `.radar ...` rules.
- `src/ui.ts` — pure helpers (`STATE_LABEL`, `isWaiting`, `shortId`, `basename`, `formatDuration`, `formatClock`, `findSelected`, layout math).
- Agent states: `THINKING TOOL WAITING_PERMISSION WAITING_INPUT ERROR IDLE SHELL ENDED STALE`.
- Scripts: `npm run typecheck`, `npm test` (vitest), `npm run build`, `npm start` (build + serve), `npm run simulate` (fake hook traffic).

## Goal
Remove the radar view entirely and replace it with an LCARS-style display (Star Trek-inspired: thick rounded elbows, pill-shaped buttons/bars, segmented color blocks, tall condensed all-caps type) as the default view. Restyle the whole app — HUD, view toggle, link status, alert, Detail panel, Sounds panel, and tree view — in the same LCARS idiom, using only the existing project palette.

## Scope
1. **Branch:** create `lcars-display` off `main`. Commit work there.
2. **Delete radar:** remove `src/Radar.tsx`, all `.radar` CSS, the `spin`-sweep usage if now unused, and `sessionPos`, `orbitPos`, `orbitRadius` from `src/ui.ts` plus their tests in `src/ui.test.ts`. No dead code left referencing radar.
3. **New LCARS view** (e.g. `src/Lcars.tsx`), default view; toggle in `App.tsx` becomes `'lcars' | 'tree'` (labels `LCARS` / `TREE`).
   - Fixed LCARS frame (top bar + left side bar joined by elbow(s)); the content region inside scrolls vertically; the frame does not scroll.
   - One elbow-framed block per session: pill header with session name (`basename(cwd)` or `shortId`), plus its row data.
   - Subagents as stacked pill rows inside the session block.
   - Every row (session header and subagent rows) shows: `Glyph` (reuse `src/Glyph.tsx`), name (`basename(cwd)`/`agentType`/`shortId`), `STATE_LABEL`, tool name + summary when in TOOL, time-in-state (`formatDuration`), a **numeric LCARS code** derived deterministically from the agent id (e.g. `47-2291`; same id → same code), and a **mini activity bar** that animates while state is THINKING or TOOL and is static otherwise.
   - State color comes from existing `st-<STATE>` classes. ENDED fade-out behavior preserved.
   - Click / Enter / Space on a row selects it (same `Selection` semantics as today); click on empty space clears selection. Selected row visibly highlighted. Rows are keyboard-focusable with visible focus.
   - Empty state: `NO CONTACTS // AWAITING HOOK TRAFFIC` rendered LCARS-style.
4. **Restyle everything else LCARS:** HUD header + counts + view toggle (pill buttons), link status, waiting alert (`--warn`), `Detail` panel, `Sounds` panel.
5. **Tree view:** keep current structure (dense one-line rows, subagents indented under session) — restyle as a compact LCARS table. LCARS view is the large decorative one; tree is the dense one.
6. **Elbows replace brackets:** remove `.brackets` helper and its uses (`Detail.tsx`, `Sounds.tsx`, `Tree.tsx`); frames use LCARS elbows/bars.
7. **Font:** load Antonio from Google Fonts (`<link>` in `index.html`, with `preconnect`), use it for `--font-head`; keep current system fonts as fallbacks. Keep `--font-mono` for data logs.
8. **Pure helpers** (numeric code, any activity-bar logic) go in `src/ui.ts` with tests in `src/ui.test.ts`.
9. **Docs:** update `README.md` (radar → LCARS) and `CLAUDE.md` (UI Primitives: LCARS elbows/pills replace corner brackets; remove radar-sweep references in style guidelines, keep the rest).

## Out of scope
- No changes to `server/`, `hooks/`, `shared/` (state model, sound mapping, SSE protocol).
- No change to sound behavior or sound config logic in `Sounds.tsx`/`sound.ts` — styling only.
- Do not edit `prompts/build-minder-first-cut.md`.
- No new colors: do not add classic LCARS orange/peach/lavender. Only the seven `:root` palette tokens (opacity/mixes of them are OK).
- No new npm dependencies (no Framer Motion etc.); CSS keyframes only.
- Do not merge or push the branch.
- Do not reproduce copyrighted Star Trek logos, insignia, or text; LCARS-*inspired* shapes and layout only.

## Constraints & conventions
- React 19 function components, TypeScript, Vite; match existing code style (terse, small components, comments only where non-obvious).
- Palette per `CLAUDE.md`: `--bg #0A0D14`, `--surface #121824`, `--accent #73fffe` (active/selected/primary), `--accent2 #6287f8`, `--structure #383e65` (frames/elbows/bars at rest), `--warn #ff6e21` (alerts/errors), `--text #e2f1f8`.
- Typography: all-caps, wide letter-spacing for headers/tags/codes; mono for data.
- Motion: transitions/fades under 200ms. Continuous loops (activity bar, existing glyph pulse/spin) are fine.
- Reuse `Glyph`, `STATE_LABEL`, `formatDuration`, `shortId`, `basename`, `findSelected`, `isWaiting`, `st-*` classes. Don't duplicate them.
- Keep existing accessibility: `role="button"`/`tabIndex`/`aria-label` on selectable rows (or real `<button>`s), `role="tablist"` toggle, `role="status"` link, `role="alert"` alert.
- Windows dev machine; never take control of the OS mouse/keyboard. Browser checks go through Claude in Chrome in a new tab only.

## Acceptance criteria
- [ ] On branch `lcars-display`; `main` untouched.
- [ ] `src/Radar.tsx` gone; `grep -ri radar src/ README.md CLAUDE.md` returns nothing (except unrelated words, if any).
- [ ] `sessionPos`, `orbitPos`, `orbitRadius` and `.brackets` no longer exist anywhere in `src/`.
- [ ] App loads into LCARS view by default; toggle shows `LCARS` / `TREE` and switches views.
- [ ] LCARS view: fixed frame with elbows; session blocks with subagent pill rows; each row shows glyph, name, state label, tool (when TOOL), time-in-state, numeric code, activity bar.
- [ ] Numeric code is deterministic per id (unit-tested).
- [ ] Activity bar animates only for THINKING/TOOL.
- [ ] With more sessions than fit, content area scrolls; frame stays fixed.
- [ ] Selecting a row (click and keyboard) opens `Detail`; clicking empty space / close clears it.
- [ ] HUD, toggle, link status, alert, Detail, Sounds, and tree all visibly LCARS-styled (pills/elbows/bars), using only palette tokens.
- [ ] Antonio loads from Google Fonts and is used for headers.
- [ ] Empty state shows `NO CONTACTS // AWAITING HOOK TRAFFIC`.
- [ ] `npm run typecheck`, `npm test`, `npm run build` all pass.
- [ ] No errors in browser console during simulation.
- [ ] README and CLAUDE.md updated as described; `prompts/build-minder-first-cut.md` unchanged.

## Verification
1. `git branch --show-current` → `lcars-display`.
2. `npm run typecheck && npm test && npm run build` — paste output.
3. `grep -rn -i "radar\|sessionPos\|orbitPos\|orbitRadius\|brackets" src README.md CLAUDE.md` — expect no hits (explain any).
4. `npm start` (background), open the served URL in a **new** Claude in Chrome tab before running the simulator → screenshot empty state.
5. `npm run simulate` (background). Screenshots: LCARS view mid-simulation (multiple sessions w/ subagents, an activity bar mid-animation), a WAITING_PERMISSION or WAITING_INPUT row with the alert visible, an ERROR row, Detail panel open after selecting a subagent, tree view, Sounds panel open, scrolled LCARS content with enough sessions to overflow (resize the window smaller via the browser tool if needed).
6. Keyboard check through the browser tool: focus a row, press Enter → Detail opens.
7. `read_console_messages` → no errors.
8. `git diff main --stat -- server hooks shared prompts/build-minder-first-cut.md` → empty.
9. Report each acceptance criterion with pass/fail and evidence (output or screenshot).

## Open assumptions / questions
- Detail panel placement assumed: floating LCARS panel on the right side over the content. Ask if a different placement is wanted.
- Numeric code format assumed `NN-NNNN` from a simple hash of the id; any stable format is fine — confirm with user if unsure.
- If Google Fonts is unreachable, system fallbacks must still render acceptably; do not bundle font files without asking.
- If a palette-only LCARS rendering looks wrong for any element, ask the user rather than adding colors.
