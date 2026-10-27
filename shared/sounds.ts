// Sound config model + hook->sound mapping. Pure; shared by server (validation) and UI (playback).
import type { AgentState } from './state.ts';

export const SOUND_KEYS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Notification',
  'WAITING_PERMISSION',
  'WAITING_INPUT',
  'ERROR',
] as const;
export type SoundKey = (typeof SOUND_KEYS)[number];

const DEFAULT_ON: SoundKey[] = ['Stop', 'SubagentStop', 'WAITING_PERMISSION', 'WAITING_INPUT', 'ERROR'];

export interface SoundSetting {
  enabled: boolean;
  volume: number; // 0..1
  source: 'synth' | 'file';
  file?: string; // basename inside data/sounds/ (server-generated)
}
export interface SoundConfig {
  muted: boolean;
  volume: number; // master, 0..1
  sounds: Record<SoundKey, SoundSetting>;
}

export function defaultConfig(): SoundConfig {
  const sounds = {} as Record<SoundKey, SoundSetting>;
  for (const k of SOUND_KEYS) sounds[k] = { enabled: DEFAULT_ON.includes(k), volume: 0.8, source: 'synth' };
  return { muted: false, volume: 0.7, sounds };
}

// Names the server generates for uploads; also the only names it will serve.
export const SAFE_FILE = /^[A-Za-z0-9_-]{1,80}\.(wav|mp3|ogg|oga|m4a|aac|flac|webm|opus)$/;

const vol = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;

// Strict validation of a client-supplied config. Returns null if anything is malformed.
// Missing keys are filled from defaults; unknown keys are dropped.
export function parseConfig(input: unknown): SoundConfig | null {
  const c = input as Partial<SoundConfig> | null;
  if (!c || typeof c !== 'object' || typeof c.muted !== 'boolean' || !vol(c.volume)) return null;
  if (!c.sounds || typeof c.sounds !== 'object') return null;
  const out = defaultConfig();
  out.muted = c.muted;
  out.volume = c.volume!;
  for (const k of SOUND_KEYS) {
    const s = (c.sounds as Record<string, Partial<SoundSetting>>)[k];
    if (s === undefined) continue;
    if (!s || typeof s.enabled !== 'boolean' || !vol(s.volume) || (s.source !== 'synth' && s.source !== 'file')) return null;
    if (s.file !== undefined && (typeof s.file !== 'string' || !SAFE_FILE.test(s.file))) return null;
    if (s.source === 'file' && !s.file) return null;
    out.sounds[k] = { enabled: s.enabled, volume: s.volume!, source: s.source, ...(s.file ? { file: s.file } : {}) };
  }
  return out;
}

// One sound per hook event. Derived states win over the raw event so nothing double-plays:
//   Notification + WAITING_PERMISSION -> WAITING_PERMISSION
//   Notification + WAITING_INPUT      -> WAITING_INPUT
//   any other Notification            -> Notification
//   PostToolUseFailure (state ERROR)  -> ERROR
//   listed hook events                -> same-named key
//   anything else                     -> no sound
export function soundKeyFor(ev: { hook_event_name: string; state?: AgentState }): SoundKey | null {
  if (ev.hook_event_name === 'Notification') {
    return ev.state === 'WAITING_PERMISSION' || ev.state === 'WAITING_INPUT' ? ev.state : 'Notification';
  }
  if (ev.hook_event_name === 'PostToolUseFailure') return 'ERROR';
  return (SOUND_KEYS as readonly string[]).includes(ev.hook_event_name) && !/^[A-Z_]+$/.test(ev.hook_event_name)
    ? (ev.hook_event_name as SoundKey)
    : null;
}
