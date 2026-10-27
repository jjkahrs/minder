// Pure state model for Minder. Every function takes `now` (ms) so time is injectable.
// Hook payload fields per https://code.claude.com/docs/en/hooks (common input fields + per-event input).

export type AgentState =
  | 'THINKING'
  | 'TOOL'
  | 'WAITING_PERMISSION'
  | 'WAITING_INPUT'
  | 'ERROR'
  | 'IDLE'
  | 'SHELL'
  | 'ENDED'
  | 'STALE';

export interface LogEntry {
  t: number;
  event: string; // hook_event_name
  detail?: string;
}

export interface Agent {
  id: string; // session_id for sessions, agent_id for subagents
  agentType?: string;
  state: AgentState;
  stateSince: number; // time the current state was entered
  lastEventAt: number;
  staleFrom?: AgentState; // state before going STALE, restored by events that don't set one
  tool?: { name: string; summary: string };
  log: LogEntry[]; // newest last, capped at LOG_CAP
}

export interface Session extends Agent {
  cwd?: string;
  inFile?: boolean; // seen in a session file, so a later missing file means the process is gone
  subagents: Record<string, Agent>;
}

export interface MinderState {
  sessions: Record<string, Session>;
}

// Subset of the hook payload Minder reads. Everything else is ignored.
export interface HookEvent {
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  message?: string;
  error?: string;
  source?: string;
  reason?: string;
}

export const LOG_CAP = 50;
export const ERROR_FLASH_MS = 1500;
export const ENDED_LINGER_MS = 3000;
export const STALE_MS = 10 * 60_000;
export const REMOVE_MS = 30 * 60_000;

export const emptyState = (): MinderState => ({ sessions: {} });

const newAgent = (id: string, now: number, agentType?: string): Agent => ({
  id,
  agentType: agentType || undefined,
  state: 'IDLE',
  stateSince: now,
  lastEventAt: now,
  log: [],
});

function setState(a: Agent, state: AgentState, now: number) {
  if (a.state !== state) a.stateSince = now;
  a.state = state;
  a.staleFrom = undefined;
  if (state !== 'TOOL') a.tool = undefined;
}

function pushLog(a: Agent, entry: LogEntry) {
  a.log.push(entry);
  if (a.log.length > LOG_CAP) a.log.splice(0, a.log.length - LOG_CAP);
}

export function summarizeInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const pick = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'prompt', 'path']
    .map((k) => input[k])
    .find((v) => typeof v === 'string');
  const s = (pick ?? Object.values(input).find((v) => typeof v === 'string') ?? '') as string;
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? line.slice(0, 79) + '…' : line;
}

const NOTIFICATION_STATES: Record<string, AgentState> = {
  permission_prompt: 'WAITING_PERMISSION',
  idle_prompt: 'WAITING_INPUT',
  elicitation_dialog: 'WAITING_INPUT',
  elicitation_url_dialog: 'WAITING_INPUT',
};

export function reduce(prev: MinderState, ev: HookEvent, now: number): MinderState {
  const state = structuredClone(prev); // ponytail: whole-state clone per event; fine for dozens of sessions
  const sid = ev.session_id;
  const name = ev.hook_event_name;

  let session = state.sessions[sid];
  if (!session) {
    // Unknown session (new, or server restarted mid-session): create it.
    session = state.sessions[sid] = { ...newAgent(sid, now), subagents: {} };
    if (name !== 'SessionStart') setState(session, 'THINKING', now);
  }
  if (ev.cwd) session.cwd = ev.cwd;
  session.lastEventAt = now;

  // Events fired inside a subagent carry agent_id; SubagentStart/Stop always do.
  let target: Agent = session;
  if (ev.agent_id) {
    let sub = session.subagents[ev.agent_id];
    // SubagentStop also fires for Claude Code's internal agents that never sent SubagentStart; don't invent those.
    if (!sub && name === 'SubagentStop') {
      pushLog(session, { t: now, event: name, detail: ev.agent_type || 'internal agent' });
      return state;
    }
    if (!sub) {
      sub = session.subagents[ev.agent_id] = newAgent(ev.agent_id, now, ev.agent_type);
      setState(sub, 'THINKING', now);
    }
    if (ev.agent_type) sub.agentType = ev.agent_type;
    sub.lastEventAt = now;
    target = sub;
  }

  let next: AgentState | undefined;
  let detail: string | undefined;
  switch (name) {
    case 'SessionStart':
      next = 'IDLE';
      detail = ev.source;
      break;
    case 'UserPromptSubmit':
    case 'PostToolUse':
      next = 'THINKING';
      detail = ev.tool_name;
      break;
    case 'PreToolUse':
      next = 'TOOL';
      detail = [ev.tool_name, summarizeInput(ev.tool_input)].filter(Boolean).join(': ');
      break;
    case 'PostToolUseFailure':
      next = 'ERROR';
      detail = [ev.tool_name, ev.error?.split('\n')[0]].filter(Boolean).join(': ');
      break;
    case 'Notification':
      next = NOTIFICATION_STATES[ev.notification_type ?? ''];
      detail = ev.message ?? ev.notification_type;
      break;
    case 'SubagentStart':
      next = 'THINKING';
      pushLog(session, { t: now, event: name, detail: ev.agent_type });
      break;
    case 'SubagentStop':
      next = 'IDLE';
      pushLog(session, { t: now, event: name, detail: ev.agent_type });
      break;
    case 'Stop':
      next = 'IDLE';
      break;
    case 'SessionEnd':
      next = 'ENDED';
      detail = ev.reason;
      break;
  }

  if (next) setState(target, next, now);
  if (next === 'TOOL') target.tool = { name: ev.tool_name ?? '?', summary: summarizeInput(ev.tool_input) };
  else if (target.state === 'STALE') setState(target, target.staleFrom ?? 'IDLE', now);
  // A session event revives a stale session even when it targeted a subagent.
  if (target !== session && session.state === 'STALE') setState(session, session.staleFrom ?? 'IDLE', now);
  pushLog(target, { t: now, event: name, detail });
  return state;
}

// Subset of ~/.claude/sessions/<pid>.json that Minder reads. Undocumented Claude Code file; see README.
export interface SessionFile {
  sessionId: string;
  cwd?: string;
  status?: string; // seen: 'busy' | 'idle' | 'shell'
  statusUpdatedAt?: number;
}

const FILE_STATES: Record<string, AgentState> = { busy: 'THINKING', idle: 'IDLE', shell: 'SHELL' };

// Adds sessions from live session files that Minder doesn't know yet (started before Minder, or before their
// first hook) and flags every session seen in a file. Known sessions keep their hook-driven state.
// Returns `prev` unchanged (same reference) when nothing changed.
export function seed(prev: MinderState, files: SessionFile[], now: number): MinderState {
  const todo = files.filter((f) => !prev.sessions[f.sessionId]?.inFile);
  if (!todo.length) return prev;
  const state = structuredClone(prev);
  for (const f of todo) {
    const known = state.sessions[f.sessionId];
    if (known) {
      known.inFile = true;
      continue;
    }
    const s: Session = { ...newAgent(f.sessionId, now), cwd: f.cwd, inFile: true, subagents: {} };
    s.state = FILE_STATES[f.status ?? ''] ?? 'IDLE';
    s.stateSince = Math.min(f.statusUpdatedAt ?? now, now);
    s.log.push({ t: now, event: 'Discovered', detail: f.status });
    state.sessions[f.sessionId] = s;
  }
  return state;
}

// Sessions once seen in a session file whose file is now gone or whose process died: crashed or killed
// processes never send SessionEnd. Sessions only ever seen via hooks are left to STALE timing.
export function vanished(state: MinderState, files: SessionFile[]): string[] {
  const live = new Set(files.map((f) => f.sessionId));
  return Object.values(state.sessions)
    .filter((s) => s.inFile && s.state !== 'ENDED' && !live.has(s.id))
    .map((s) => s.id);
}

// Time-driven transitions: ERROR flash ends, ENDED removal, STALE, 30-min removal.
// Returns `prev` unchanged (same reference) when nothing changed.
export function tick(prev: MinderState, now: number): MinderState {
  let changed = false;
  const state = structuredClone(prev);

  const age = (a: Agent) => now - a.lastEventAt;
  const step = (a: Agent) => {
    if (a.state === 'ERROR' && now - a.stateSince >= ERROR_FLASH_MS) {
      setState(a, 'THINKING', now);
      changed = true;
    }
    if (a.state !== 'STALE' && a.state !== 'ENDED' && age(a) >= STALE_MS) {
      const from = a.state;
      setState(a, 'STALE', now);
      a.staleFrom = from;
      changed = true;
    }
  };

  for (const [sid, s] of Object.entries(state.sessions)) {
    const ended = s.state === 'ENDED' && now - s.stateSince >= ENDED_LINGER_MS;
    if (ended || age(s) >= REMOVE_MS) {
      delete state.sessions[sid];
      changed = true;
      continue;
    }
    step(s);
    for (const [aid, a] of Object.entries(s.subagents)) {
      if (age(a) >= REMOVE_MS) {
        delete s.subagents[aid];
        changed = true;
      } else step(a);
    }
  }
  return changed ? state : prev;
}
