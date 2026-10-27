import { useEffect, useState } from 'react';
import type { MinderState } from '../shared/state.ts';

// Placeholder UI (phase 1): live snapshot dump. Real views come in a later phase.
export function App() {
  const [state, setState] = useState<MinderState>({ sessions: {} });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream'); // EventSource auto-reconnects
    es.addEventListener('snapshot', (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return (
    <main style={{ background: '#0A0D14', color: '#e2f1f8', minHeight: '100vh', margin: 0, padding: 16, fontFamily: 'monospace' }}>
      <h1 style={{ letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 14, color: '#73fffe' }}>
        Minder // {connected ? 'linked' : <span style={{ color: '#ff6e21' }}>no signal</span>}
      </h1>
      <pre style={{ fontSize: 12 }}>{JSON.stringify(state, null, 2)}</pre>
    </main>
  );
}
