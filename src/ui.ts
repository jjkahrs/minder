// Pure UI helpers (layout math, formatting, selection lookup). Unit-tested in ui.test.ts.
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

// Session i on the radar, relative to the radar center. Golden-angle spread keeps
// earlier sessions in place as new ones arrive; radius cycles between 0.32R and 0.82R.
export function sessionPos(i: number, R: number) {
  const angle = ((-90 + i * 137.508) * Math.PI) / 180;
  const r = R * (0.32 + 0.5 * ((i * 0.618034) % 1));
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

// Subagent j of n, evenly spaced on an orbit around its parent (starting at 12 o'clock).
export function orbitPos(j: number, n: number, radius: number) {
  const angle = -Math.PI / 2 + (2 * Math.PI * j) / Math.max(n, 1);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

// Orbit grows with subagent count so nodes don't overlap.
export const orbitRadius = (n: number) => 46 + Math.max(0, n - 4) * 6;

export function findSelected(state: MinderState, sel: Selection | null): { session: Session; agent: Agent } | null {
  const session = sel && state.sessions[sel.sessionId];
  if (!session) return null;
  if (!sel.agentId) return { session, agent: session };
  const agent = session.subagents[sel.agentId];
  return agent ? { session, agent } : null;
}
