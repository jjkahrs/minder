// Browser-side playback: synthesized Web Audio defaults, or an uploaded file served from /api/sounds/.
import type { SoundConfig, SoundKey } from '../shared/sounds.ts';

// [frequency Hz, start s, duration s] per note; each key gets its own waveform + motif.
type Note = [number, number, number];
const SYNTH: Record<SoundKey, { wave: OscillatorType; notes: Note[] }> = {
  SessionStart: { wave: 'sine', notes: [[440, 0, 0.09], [660, 0.09, 0.09], [880, 0.18, 0.14]] },
  SessionEnd: { wave: 'sine', notes: [[880, 0, 0.09], [660, 0.09, 0.09], [440, 0.18, 0.16]] },
  UserPromptSubmit: { wave: 'triangle', notes: [[1046, 0, 0.05]] },
  PreToolUse: { wave: 'square', notes: [[1568, 0, 0.025]] },
  PostToolUse: { wave: 'square', notes: [[1175, 0, 0.025]] },
  SubagentStart: { wave: 'triangle', notes: [[587, 0, 0.06], [880, 0.06, 0.08]] },
  SubagentStop: { wave: 'triangle', notes: [[880, 0, 0.06], [587, 0.07, 0.1]] },
  Stop: { wave: 'sine', notes: [[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1046, 0.3, 0.25]] },
  Notification: { wave: 'sine', notes: [[740, 0, 0.12]] },
  WAITING_PERMISSION: { wave: 'sawtooth', notes: [[988, 0, 0.1], [740, 0.14, 0.1], [988, 0.28, 0.1], [740, 0.42, 0.14]] },
  WAITING_INPUT: { wave: 'triangle', notes: [[659, 0, 0.16], [988, 0.2, 0.22]] },
  ERROR: { wave: 'sawtooth', notes: [[196, 0, 0.12], [147, 0.12, 0.22]] },
};

let ctx: AudioContext | undefined;
export const audioContext = () => (ctx ??= new AudioContext());

// Browsers keep the context suspended until a user gesture; the UI shows an "enable audio" affordance until then.
export const audioLocked = () => audioContext().state !== 'running';
export const unlockAudio = () => audioContext().resume();

function synth(key: SoundKey, volume: number) {
  const ac = audioContext();
  const { wave, notes } = SYNTH[key];
  const t0 = ac.currentTime + 0.01;
  for (const [freq, start, dur] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    // Short attack/decay envelope; sawtooth/square are harsher, so scale them down.
    const peak = volume * (wave === 'sine' || wave === 'triangle' ? 0.5 : 0.18);
    gain.gain.setValueAtTime(0, t0 + start);
    gain.gain.linearRampToValueAtTime(peak, t0 + start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.02);
  }
}

// force: test button plays even when muted / the key is toggled off.
export function playSound(key: SoundKey, cfg: SoundConfig, force = false) {
  const s = cfg.sounds[key];
  if (!force && (cfg.muted || !s.enabled)) return;
  const volume = cfg.volume * s.volume;
  if (volume <= 0) return;
  if (s.source === 'file' && s.file) {
    const el = new Audio(`/api/sounds/${encodeURIComponent(s.file)}`);
    el.volume = volume;
    el.play().catch(() => {}); // autoplay-locked or missing file: stay silent
  } else {
    synth(key, volume);
  }
}
