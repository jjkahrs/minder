import { useEffect, useRef, useState } from 'react';
import { SOUND_KEYS, type SoundConfig, type SoundKey, type SoundSetting } from '../shared/sounds.ts';
import { audioContext, audioLocked, playSound, unlockAudio } from './sound.ts';

const LABEL: Record<SoundKey, string> = {
  SessionStart: 'SESSION START',
  SessionEnd: 'SESSION END',
  UserPromptSubmit: 'PROMPT SUBMIT',
  PreToolUse: 'TOOL START',
  PostToolUse: 'TOOL DONE',
  SubagentStart: 'SUBAGENT START',
  SubagentStop: 'SUBAGENT STOP',
  Stop: 'STOP',
  Notification: 'NOTIFICATION',
  WAITING_PERMISSION: 'AWAIT PERMISSION',
  WAITING_INPUT: 'AWAIT INPUT',
  ERROR: 'ERROR',
};

export function Sounds({ cfg, onChange }: { cfg: SoundConfig; onChange: (c: SoundConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(audioLocked);
  const [err, setErr] = useState('');
  const latest = useRef(cfg); // upload() resolves later; patch the newest config, not the one it closed over
  latest.current = cfg;

  useEffect(() => {
    // Any gesture anywhere unlocks audio, not just the button.
    const ac = audioContext();
    const sync = () => setLocked(audioLocked());
    const gesture = () => void unlockAudio().then(sync);
    ac.addEventListener('statechange', sync);
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      ac.removeEventListener('statechange', sync);
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
    };
  }, []);

  const set = (key: SoundKey, patch: Partial<SoundSetting>) => {
    const c = latest.current;
    onChange({ ...c, sounds: { ...c.sounds, [key]: { ...c.sounds[key], ...patch } } });
  };

  async function upload(key: SoundKey, f: File) {
    setErr('');
    const r = await fetch(`/api/sounds?name=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: { 'content-type': f.type || 'application/octet-stream' },
      body: f,
    }).catch(() => null);
    if (!r?.ok) return setErr(r?.status === 413 ? 'FILE TOO LARGE (10MB MAX)' : r?.status === 415 ? 'NOT AN AUDIO FILE' : 'UPLOAD FAILED');
    const { file } = await r.json();
    set(key, { source: 'file', file });
  }

  return (
    <div className="sounds">
      {locked && (
        <button className="enable-audio tag" onClick={() => void unlockAudio().then(() => setLocked(audioLocked()))}>
          ▶ ENABLE AUDIO
        </button>
      )}
      {open && (
        <section className="sound-panel elbows" aria-label="sound settings">
          <header className="tag">
            AUDIO MATRIX {err && <span className="err">// {err}</span>}
          </header>
          <div className="sound-rows">
            {SOUND_KEYS.map((k) => {
              const s = cfg.sounds[k];
              return (
                <div key={k} className={`sound-row ${s.enabled ? 'on' : ''}`} data-key={k}>
                  <label className="tag">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => set(k, { enabled: e.target.checked })} />
                    {LABEL[k]}
                  </label>
                  <input type="range" min={0} max={1} step={0.05} value={s.volume} aria-label={`${k} volume`} onChange={(e) => set(k, { volume: Number(e.target.value) })} />
                  <select value={s.source} aria-label={`${k} source`} onChange={(e) => set(k, { source: e.target.value as SoundSetting['source'] })}>
                    <option value="synth">SYNTH</option>
                    <option value="file" disabled={!s.file}>
                      {s.file ? s.file : 'FILE'}
                    </option>
                  </select>
                  <label className="upload tag" title="upload audio file">
                    ⇪
                    <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && void upload(k, e.target.files[0])} />
                  </label>
                  <button className="test tag" onClick={() => playSound(k, cfg, true)} aria-label={`test ${k}`}>
                    TEST
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="sound-bar">
        <button className={`tag ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          ♪ SOUND CFG
        </button>
        <button className={`tag mute ${cfg.muted ? 'muted' : ''}`} onClick={() => onChange({ ...cfg, muted: !cfg.muted })} aria-pressed={cfg.muted}>
          {cfg.muted ? 'MUTED' : 'MUTE'}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={cfg.volume} aria-label="master volume" onChange={(e) => onChange({ ...cfg, volume: Number(e.target.value) })} />
        <span className="readout">{Math.round(cfg.volume * 100).toString().padStart(3, '0')}</span>
      </div>
    </div>
  );
}

// Debounced PUT so slider drags don't flood the server; latest value wins.
export function useSoundConfig() {
  const [cfg, setCfg] = useState<SoundConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);
  const update = (c: SoundConfig) => {
    setCfg(c);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }).catch(() => {});
    }, 250);
  };
  return [cfg, update] as const;
}
