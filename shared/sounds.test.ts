import { describe, it, expect } from 'vitest';
import { defaultConfig, parseConfig, SOUND_KEYS, soundKeyFor } from './sounds.ts';

describe('sound config', () => {
  it('defaults: ON only for Stop, SubagentStop, waiting states, ERROR; synth source', () => {
    const c = defaultConfig();
    const on = SOUND_KEYS.filter((k) => c.sounds[k].enabled);
    expect(on.sort()).toEqual(['ERROR', 'Stop', 'SubagentStop', 'WAITING_INPUT', 'WAITING_PERMISSION']);
    expect(SOUND_KEYS.every((k) => c.sounds[k].source === 'synth')).toBe(true);
    expect(c.muted).toBe(false);
  });

  it('parseConfig accepts valid, fills missing keys, rejects malformed', () => {
    const c = defaultConfig();
    expect(parseConfig(c)).toEqual(c);
    expect(parseConfig({ muted: true, volume: 0.5, sounds: {} })).toEqual({ ...c, muted: true, volume: 0.5 });
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig({ ...c, volume: 2 })).toBeNull();
    expect(parseConfig({ ...c, muted: 'no' })).toBeNull();
    const bad = (s: object) => parseConfig({ ...c, sounds: { Stop: { enabled: true, volume: 0.5, source: 'synth', ...s } } });
    expect(bad({ source: 'mp3' })).toBeNull();
    expect(bad({ source: 'file' })).toBeNull(); // file source with no file
    expect(bad({ file: '../config.json' })).toBeNull();
    expect(bad({ file: 'x.exe' })).toBeNull();
    expect(bad({ source: 'file', file: 'ding-abc.wav' })?.sounds.Stop.file).toBe('ding-abc.wav');
  });
});

describe('soundKeyFor', () => {
  it('maps each hook to exactly one key; derived states win over Notification', () => {
    expect(soundKeyFor({ hook_event_name: 'Notification', state: 'WAITING_PERMISSION' })).toBe('WAITING_PERMISSION');
    expect(soundKeyFor({ hook_event_name: 'Notification', state: 'WAITING_INPUT' })).toBe('WAITING_INPUT');
    expect(soundKeyFor({ hook_event_name: 'Notification', state: 'THINKING' })).toBe('Notification');
    expect(soundKeyFor({ hook_event_name: 'PostToolUseFailure', state: 'ERROR' })).toBe('ERROR');
    for (const k of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop'])
      expect(soundKeyFor({ hook_event_name: k })).toBe(k);
    expect(soundKeyFor({ hook_event_name: 'PreCompact' })).toBeNull();
    expect(soundKeyFor({ hook_event_name: 'ERROR' })).toBeNull(); // derived keys aren't hook names
  });
});
