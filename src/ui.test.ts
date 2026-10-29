import { describe, it, expect } from 'vitest';
import { basename, findSelected, formatDuration, isActive, lcarsCode } from './ui.ts';
import { emptyState, reduce } from '../shared/state.ts';

describe('ui helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(7_900)).toBe('00:07');
    expect(formatDuration(192_000)).toBe('03:12');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(-5_000)).toBe('00:00');
  });

  it('derives a stable NN-NNNN code per id', () => {
    const ids = ['a', 'b', 'session-1', 'session-2', '3f2c9e1a-0000-4000-8000-000000000000'];
    const codes = ids.map(lcarsCode);
    for (const c of codes) expect(c).toMatch(/^\d{2}-\d{4}$/);
    expect(ids.map(lcarsCode)).toEqual(codes);
    expect(new Set(codes).size).toBe(ids.length);
    expect(lcarsCode('')).toMatch(/^\d{2}-\d{4}$/);
  });

  it('marks only THINKING and TOOL as active', () => {
    const states = ['THINKING', 'TOOL', 'WAITING_PERMISSION', 'WAITING_INPUT', 'ERROR', 'IDLE', 'SHELL', 'ENDED', 'STALE'] as const;
    expect(states.filter(isActive)).toEqual(['THINKING', 'TOOL']);
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
