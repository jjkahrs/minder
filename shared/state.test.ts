import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emptyState,
  reduce,
  seed,
  vanished,
  tick,
  summarizeInput,
  LOG_CAP,
  ERROR_FLASH_MS,
  ENDED_LINGER_MS,
  STALE_MS,
  REMOVE_MS,
  type HookEvent,
  type MinderState,
} from './state.ts';

const S = 'sess-1';
const ev = (hook_event_name: string, extra: Partial<HookEvent> = {}): HookEvent => ({
  session_id: S,
  cwd: 'C:\\dev\\proj',
  hook_event_name,
  ...extra,
});
const run = (events: HookEvent[], t0 = 1000) => events.reduce((s, e, i) => reduce(s, e, t0 + i), emptyState());

describe('session transitions', () => {
  it('SessionStart creates an IDLE session with cwd', () => {
    const s = run([ev('SessionStart', { source: 'startup' })]).sessions[S];
    expect(s.state).toBe('IDLE');
    expect(s.cwd).toBe('C:\\dev\\proj');
    expect(s.subagents).toEqual({});
  });

  it('UserPromptSubmit -> THINKING, PreToolUse -> TOOL with summary, PostToolUse -> THINKING', () => {
    let st = run([ev('SessionStart'), ev('UserPromptSubmit', { prompt: 'hi' } as any)]);
    expect(st.sessions[S].state).toBe('THINKING');
    st = reduce(st, ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm   test', description: 'Run' } }), 5000);
    expect(st.sessions[S].state).toBe('TOOL');
    expect(st.sessions[S].tool).toEqual({ name: 'Bash', summary: 'npm test' });
    expect(st.sessions[S].stateSince).toBe(5000);
    st = reduce(st, ev('PostToolUse', { tool_name: 'Bash' }), 6000);
    expect(st.sessions[S].state).toBe('THINKING');
    expect(st.sessions[S].tool).toBeUndefined();
  });

  it('Notification permission_prompt / idle_prompt -> waiting states; other types only log', () => {
    let st = run([ev('UserPromptSubmit')]);
    st = reduce(st, ev('Notification', { notification_type: 'permission_prompt', message: 'needs permission' }), 2000);
    expect(st.sessions[S].state).toBe('WAITING_PERMISSION');
    st = reduce(st, ev('Notification', { notification_type: 'idle_prompt' }), 3000);
    expect(st.sessions[S].state).toBe('WAITING_INPUT');
    st = reduce(st, ev('Notification', { notification_type: 'auth_success' }), 4000);
    expect(st.sessions[S].state).toBe('WAITING_INPUT');
    expect(st.sessions[S].log.at(-1)?.event).toBe('Notification');
  });

  it('PostToolUseFailure -> ERROR, then tick returns it to THINKING after the flash', () => {
    let st = run([ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'Bash' })]);
    st = reduce(st, ev('PostToolUseFailure', { tool_name: 'Bash', error: 'Exit code 1\nboom' }), 10_000);
    expect(st.sessions[S].state).toBe('ERROR');
    expect(st.sessions[S].log.at(-1)?.detail).toBe('Bash: Exit code 1');
    expect(tick(st, 10_000 + ERROR_FLASH_MS - 1)).toBe(st); // unchanged, same reference
    const after = tick(st, 10_000 + ERROR_FLASH_MS);
    expect(after.sessions[S].state).toBe('THINKING');
    expect(after.sessions[S].stateSince).toBe(10_000 + ERROR_FLASH_MS);
  });

  it('Stop -> IDLE; SessionEnd -> ENDED, removed after linger', () => {
    let st = run([ev('UserPromptSubmit'), ev('Stop')]);
    expect(st.sessions[S].state).toBe('IDLE');
    st = reduce(st, ev('SessionEnd', { reason: 'prompt_input_exit' }), 20_000);
    expect(st.sessions[S].state).toBe('ENDED');
    expect(tick(st, 20_000 + ENDED_LINGER_MS - 1).sessions[S]).toBeDefined();
    expect(tick(st, 20_000 + ENDED_LINGER_MS).sessions[S]).toBeUndefined();
  });

  it('events for an unknown session create it (server restarted mid-session)', () => {
    const st = run([ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:\\a.ts' } })]);
    expect(st.sessions[S].state).toBe('TOOL');
    expect(st.sessions[S].tool?.summary).toBe('C:\\a.ts');
  });

  it('reduce does not mutate the previous state', () => {
    const a = run([ev('SessionStart')]);
    const snap = structuredClone(a);
    reduce(a, ev('UserPromptSubmit'), 9999);
    expect(a).toEqual(snap);
  });
});

describe('subagents', () => {
  const sub = (name: string, agent_id: string, extra: Partial<HookEvent> = {}) =>
    ev(name, { agent_id, agent_type: 'Explore', ...extra });

  it('nest under the parent session and track their own state', () => {
    let st = run([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { tool_name: 'Agent' }),
      sub('SubagentStart', 'a1'),
      sub('SubagentStart', 'a2', { agent_type: 'Plan' }),
      sub('PreToolUse', 'a1', { tool_name: 'Grep', tool_input: { pattern: 'foo' } }),
    ]);
    const s = st.sessions[S];
    expect(Object.keys(s.subagents)).toEqual(['a1', 'a2']);
    expect(s.subagents.a1).toMatchObject({ state: 'TOOL', agentType: 'Explore', tool: { name: 'Grep', summary: 'foo' } });
    expect(s.subagents.a2).toMatchObject({ state: 'THINKING', agentType: 'Plan' });
    expect(s.state).toBe('TOOL'); // parent still in its Agent tool call
    expect(s.log.map((l) => l.event)).toContain('SubagentStart');

    st = reduce(st, sub('PostToolUseFailure', 'a1', { tool_name: 'Grep', error: 'x' }), 5000);
    expect(st.sessions[S].subagents.a1.state).toBe('ERROR');
    expect(st.sessions[S].state).toBe('TOOL');
    st = reduce(st, sub('SubagentStop', 'a1'), 6000);
    expect(st.sessions[S].subagents.a1.state).toBe('IDLE');
    expect(st.sessions[S].subagents.a1.log.map((l) => l.event)).toEqual([
      'SubagentStart',
      'PreToolUse',
      'PostToolUseFailure',
      'SubagentStop',
    ]);
  });

  it('subagent permission notification marks only the subagent', () => {
    const st = run([ev('UserPromptSubmit'), sub('SubagentStart', 'a1'), sub('Notification', 'a1', { notification_type: 'permission_prompt' })]);
    expect(st.sessions[S].subagents.a1.state).toBe('WAITING_PERMISSION');
    expect(st.sessions[S].state).toBe('THINKING');
  });

  it('SubagentStop for an unknown (internal) agent does not create a subagent', () => {
    const st = run([ev('UserPromptSubmit'), ev('SubagentStop', { agent_id: 'internal', agent_type: '' })]);
    expect(st.sessions[S].subagents).toEqual({});
  });

  it('tool event with unknown agent_id creates the subagent (missed SubagentStart)', () => {
    const st = run([ev('UserPromptSubmit'), sub('PreToolUse', 'a9', { tool_name: 'Read' })]);
    expect(st.sessions[S].subagents.a9.state).toBe('TOOL');
  });
});

describe('event log', () => {
  it(`caps each agent log at ${LOG_CAP}, keeping the newest`, () => {
    const events = Array.from({ length: 120 }, (_, i) => ev(i % 2 ? 'PostToolUse' : 'PreToolUse', { tool_name: `T${i}` }));
    const s = run(events).sessions[S];
    expect(s.log).toHaveLength(LOG_CAP);
    expect(s.log.at(-1)?.detail).toBe('T119');
    expect(s.log[0].detail).toBe(`T${120 - LOG_CAP}`);
  });
});

describe('summarizeInput', () => {
  it('prefers known keys, collapses whitespace, truncates to 80', () => {
    expect(summarizeInput(undefined)).toBe('');
    expect(summarizeInput({ url: 'https://x', prompt: 'p' })).toBe('https://x');
    expect(summarizeInput({ foo: 1, bar: 'baz' })).toBe('baz');
    const long = summarizeInput({ command: 'a'.repeat(200) });
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('stale / removal (fake timers)', () => {
  afterEach(() => vi.useRealTimers());

  // Drive tick from a real setInterval under fake timers, like the server does.
  function driver(initial: MinderState) {
    let state = initial;
    const id = setInterval(() => (state = tick(state, Date.now())), 1000);
    return { get: () => state, stop: () => clearInterval(id), set: (s: MinderState) => (state = s) };
  }

  it('STALE after 10 min of silence, revived by a new event, removed after 30 min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const d = driver(
      [ev('UserPromptSubmit'), ev('Notification', { notification_type: 'permission_prompt' })].reduce(
        (s, e) => reduce(s, e, Date.now()),
        emptyState(),
      ),
    );

    vi.advanceTimersByTime(STALE_MS - 1000);
    expect(d.get().sessions[S].state).toBe('WAITING_PERMISSION');
    vi.advanceTimersByTime(1000);
    expect(d.get().sessions[S].state).toBe('STALE');

    // An event with no state of its own restores the pre-stale state.
    d.set(reduce(d.get(), ev('Notification', { notification_type: 'auth_success' }), Date.now()));
    expect(d.get().sessions[S].state).toBe('WAITING_PERMISSION');

    vi.advanceTimersByTime(STALE_MS);
    expect(d.get().sessions[S].state).toBe('STALE');
    vi.advanceTimersByTime(REMOVE_MS - STALE_MS - 1000);
    expect(d.get().sessions[S]).toBeDefined();
    vi.advanceTimersByTime(1000);
    expect(d.get().sessions[S]).toBeUndefined();
    d.stop();
  });

  it('subagents go stale and are removed on their own clock; parent stays alive while subagent events flow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const d = driver(
      [ev('UserPromptSubmit'), ev('SubagentStart', { agent_id: 'a1' }), ev('SubagentStart', { agent_id: 'a2' })].reduce(
        (s, e) => reduce(s, e, Date.now()),
        emptyState(),
      ),
    );
    // a2 keeps producing events every 5 min; a1 goes silent.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(5 * 60_000);
      d.set(reduce(d.get(), ev('PostToolUse', { agent_id: 'a2' }), Date.now()));
    }
    vi.advanceTimersByTime(1000);
    const s = d.get().sessions[S];
    expect(s.state).toBe('THINKING'); // subagent events keep the session's clock fresh...
    expect(s.subagents.a2.state).toBe('THINKING');
    expect(s.subagents.a1).toBeUndefined(); // ...but silent a1 was removed at 30 min
    d.stop();
  });
});

describe('seed (sessions running before Minder started)', () => {
  it('adds unknown sessions with status mapped to a state', () => {
    const s = seed(
      emptyState(),
      [
        { sessionId: 'a', cwd: 'C:\dev\a', status: 'busy', statusUpdatedAt: 500 },
        { sessionId: 'b', status: 'idle' },
        { sessionId: 'c', status: 'shell' },
        { sessionId: 'd', status: 'something-new' },
      ],
      1000,
    );
    expect(s.sessions.a).toMatchObject({ state: 'THINKING', stateSince: 500, lastEventAt: 1000, cwd: 'C:\dev\a' });
    expect(s.sessions.b.state).toBe('IDLE');
    expect(s.sessions.c.state).toBe('SHELL');
    expect(s.sessions.d.state).toBe('IDLE');
    expect(s.sessions.a.log[0]).toMatchObject({ event: 'Discovered', detail: 'busy' });
  });

  it('never overwrites a session already known from hooks', () => {
    const prev = run([ev('PreToolUse', { tool_name: 'Bash' })]);
    const s = seed(prev, [{ sessionId: S, status: 'idle' }], 5000);
    expect(s.sessions[S]).toEqual({ ...prev.sessions[S], inFile: true });
  });

  it('returns the same reference when a rescan finds nothing new', () => {
    const s = seed(emptyState(), [{ sessionId: 'a', status: 'idle' }], 1000);
    expect(seed(s, [{ sessionId: 'a', status: 'busy' }], 6000)).toBe(s);
  });

  it('hooks take over a seeded session', () => {
    const s = reduce(seed(emptyState(), [{ sessionId: S, status: 'shell' }], 1000), ev('UserPromptSubmit'), 2000);
    expect(s.sessions[S].state).toBe('THINKING');
  });
});

describe('vanished (process gone without SessionEnd)', () => {
  it('lists only file-seen, not-ended sessions missing from the live files', () => {
    let s = run([ev('UserPromptSubmit'), ev('UserPromptSubmit', { session_id: 'hook-only' })]);
    s = seed(s, [{ sessionId: S }, { sessionId: 'a' }, { sessionId: 'b' }], 2000);
    s = reduce(s, ev('SessionEnd', { session_id: 'b' }), 3000);
    expect(vanished(s, [{ sessionId: 'a' }])).toEqual([S]);
    expect(vanished(s, [{ sessionId: S }, { sessionId: 'a' }])).toEqual([]);
  });
});
