import { useEffect, useRef, useState } from 'react';
import { soundKeyFor } from '../shared/sounds.ts';
import type { MinderState } from '../shared/state.ts';
import { Detail } from './Detail.tsx';
import { Radar } from './Radar.tsx';
import { playSound } from './sound.ts';
import { Sounds, useSoundConfig } from './Sounds.tsx';
import { Tree } from './Tree.tsx';
import { findSelected, isWaiting, type Selection } from './ui.ts';

export function App() {
  const [state, setState] = useState<MinderState>({ sessions: {} });
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'radar' | 'tree'>('radar');
  const [sel, setSel] = useState<Selection | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cfg, setCfg] = useSoundConfig();
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // EventSource retries on its own after network errors; if it gives up (CLOSED), reconnect manually.
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('snapshot', (e) => setState(JSON.parse((e as MessageEvent).data)));
      es.addEventListener('hook', (e) => {
        const key = soundKeyFor(JSON.parse((e as MessageEvent).data));
        if (key && cfgRef.current) playSound(key, cfgRef.current);
      });
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        if (es.readyState === EventSource.CLOSED && !disposed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      es.close();
    };
  }, []);

  const sessions = Object.values(state.sessions);
  const agents = sessions.flatMap((s) => [s, ...Object.values(s.subagents)]);
  const waiting = agents.filter((a) => isWaiting(a.state)).length;
  const selected = findSelected(state, sel);

  return (
    <div className={`app view-${view}`}>
      {view === 'radar' ? <Radar state={state} sel={sel} onSelect={setSel} /> : <Tree state={state} sel={sel} now={now} onSelect={setSel} />}

      <header className="hud">
        <h1>
          MINDER <span className="dim">// AGENT TELEMETRY</span>
        </h1>
        <div className="counts">
          <span>
            SESSIONS <b>{sessions.length}</b>
          </span>
          <span>
            AGENTS <b>{agents.length}</b>
          </span>
        </div>
        <div className="toggle" role="tablist" aria-label="view">
          {(['radar', 'tree'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
      </header>

      <div className={`link ${connected ? 'up' : 'down'}`} role="status">
        <i /> {connected ? 'LINK ONLINE' : 'NO SIGNAL // RECONNECTING'}
      </div>
      {cfg && <Sounds cfg={cfg} onChange={setCfg} />}

      {waiting > 0 && (
        <div className="alert" role="alert">
          ▲ {waiting} AGENT{waiting > 1 ? 'S' : ''} AWAITING OPERATOR
        </div>
      )}

      {selected && <Detail session={selected.session} agent={selected.agent} now={now} onClose={() => setSel(null)} />}
    </div>
  );
}
