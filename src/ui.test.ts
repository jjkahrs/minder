import { describe, it, expect } from 'vitest';
import { basename, findSelected, formatDuration, orbitPos, sessionPos } from './ui.ts';
import { emptyState, reduce } from '../shared/state.ts';

describe('ui helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(7_900)).toBe('00:07');
    expect(formatDuration(192_000)).toBe('03:12');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(-5_000)).toBe('00:00');
  });

  it('places sessions within the radar and spreads them out', () => {
    const R = 360;
    const pts = Array.from({ length: 12 }, (_, i) => sessionPos(i, R));
    for (const p of pts) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThanOrEqual(0.32 * R - 1e-9);
      expect(r).toBeLessThanOrEqual(0.82 * R + 1e-9);
    }
    // first few sessions are well separated
    for (let a = 0; a < 5; a++)
      for (let b = a + 1; b < 5; b++)
        expect(Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y)).toBeGreaterThan(80);
    // stable: adding sessions doesn't move earlier ones
    expect(sessionPos(0, R)).toEqual(pts[0]);
  });

  it('spaces subagents evenly on the orbit', () => {
    const [a, b] = [orbitPos(0, 2, 50), orbitPos(1, 2, 50)];
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(-50);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(50);
    expect(Math.hypot(orbitPos(2, 3, 50).x, orbitPos(2, 3, 50).y)).toBeCloseTo(50);
  });

  it('takes basename of windows and posix paths', () => {
    expect(basename('C:\\dev\\minder')).toBe('minder');
    expect(basename('/home/x/proj/')).toBe('proj');
    expect(basename(undefined)).toBe('');
  });

  it('finds selected session or subagent, null when gone', () => {
    let s = reduce(emptyState(), { session_id: 'S', hook_event_name: 'SessionStart' }, 0);
    s = reduce(s, { session_id: 'S', hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }, 1);
    expect(findSelected(s, { sessionId: 'S' })?.agent.id).toBe('S');
    expect(findSelected(s, { sessionId: 'S', agentId: 'A' })?.agent.agentType).toBe('Explore');
    expect(findSelected(s, { sessionId: 'S', agentId: 'B' })).toBeNull();
    expect(findSelected(s, { sessionId: 'X' })).toBeNull();
    expect(findSelected(s, null)).toBeNull();
  });
});
