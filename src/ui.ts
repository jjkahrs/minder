// Pure UI helpers (formatting, readout codes, selection lookup). Unit-tested in ui.test.ts.
import type { Agent, AgentState, MinderState, Session } from '../shared/state.ts';

export interface Selection {
  sessionId: string;
  agentId?: string; // set when a subagent is selected
}

export const STATE_LABEL: Record<AgentState, string> = {
  THINKING: 'THINKING',
  TOOL: 'TOOL',
  WAITING_PERMISSION: 'AWAIT PERMISSION',
  WAITING_INPUT: 'AWAIT INPUT',
  ERROR: 'ERROR',
  IDLE: 'IDLE',
  SHELL: 'SHELL',
  ENDED: 'ENDED',
  STALE: 'STALE',
};

export const isWaiting = (s: AgentState) => s === 'WAITING_PERMISSION' || s === 'WAITING_INPUT';

export const shortId = (id: string) => id.slice(0, 8);

export const basename = (p?: string) => (p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : '');

// 7s -> "00:07", 192s -> "03:12", 3723s -> "1:02:03". Negative (clock skew) clamps to 0.
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const formatClock = (t: number) => new Date(t).toTimeString().slice(0, 8);

// Stable LCARS-style readout code for an id, e.g. "47-2291" (FNV-1a hash).
export function lcarsCode(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  const n = (h >>> 0) % 1_000_000;
  return `${String(Math.floor(n / 10_000)).padStart(2, '0')}-${String(n % 10_000).padStart(4, '0')}`;
}

// Activity bars animate only while the agent is doing work.
export const isActive = (s: AgentState) => s === 'THINKING' || s === 'TOOL';

export function findSelected(state: MinderState, sel: Selection | null): { session: Session; agent: Agent } | null {
  const session = sel && state.sessions[sel.sessionId];
  if (!session) return null;
  if (!sel.agentId) return { session, agent: session };
  const agent = session.subagents[sel.agentId];
  return agent ? { session, agent } : null;
}
