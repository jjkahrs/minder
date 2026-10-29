import { useEffect, useRef } from 'react';
import { LOG_CAP, type Agent, type Session } from '../shared/state.ts';
import { Glyph } from './Glyph.tsx';
import { formatClock, formatDuration, shortId, STATE_LABEL } from './ui.ts';

export function Detail({ session, agent, now, onClose }: { session: Session; agent: Agent; now: number; onClose: () => void }) {
  const isSub = agent !== session;
  const logRef = useRef<HTMLOListElement>(null);
  const last = agent.log.at(-1)?.t;
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [agent.id, last]);

  return (
    <aside className="detail elbows" aria-label="agent detail">
      <header>
        <span className="tag">{isSub ? 'SUBAGENT' : 'SESSION'} // TARGET LOCK</span>
        <button className="close" onClick={onClose} aria-label="close detail">
          ×
        </button>
      </header>
      <div className={`state-line st-${agent.state}`}>
        <svg className="reticle big" viewBox="-30 -30 60 60" aria-hidden>
          <Glyph state={agent.state} r={12} />
        </svg>
        <div>
          <div className="state">{STATE_LABEL[agent.state]}</div>
          <div className="counter" title="time in state">
            {formatDuration(now - agent.stateSince)}
          </div>
        </div>
      </div>
      {agent.tool && (
        <div className="tool">
          <span className="tag">TOOL</span> {agent.tool.name}
          {agent.tool.summary && <div className="summary">{agent.tool.summary}</div>}
        </div>
      )}
      <dl>
        <dt>SESSION</dt>
        <dd>{shortId(session.id)}</dd>
        {isSub && (
          <>
            <dt>AGENT ID</dt>
            <dd>{shortId(agent.id)}</dd>
          </>
        )}
        <dt>TYPE</dt>
        <dd>{agent.agentType ?? (isSub ? '—' : 'main')}</dd>
        <dt>CWD</dt>
        <dd className="wrap">{session.cwd ?? '—'}</dd>
        <dt>SUBAGENTS</dt>
        <dd>{Object.keys(session.subagents).length}</dd>
      </dl>
      <div className="tag">
        EVENT LOG <span className="dim">[{agent.log.length}/{LOG_CAP}]</span>
      </div>
      <ol className="log" ref={logRef}>
        {agent.log.map((l, i) => (
          <li key={i}>
            <time>{formatClock(l.t)}</time> <b>{l.event}</b> {l.detail && <span className="dim">{l.detail}</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
