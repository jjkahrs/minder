import type { Agent, MinderState } from '../shared/state.ts';
import { Glyph } from './Glyph.tsx';
import { basename, formatDuration, isActive, lcarsCode, shortId, STATE_LABEL, type Selection } from './ui.ts';

const BAR_SEGMENTS = 8;

export function Lcars({ state, sel, now, onSelect }: { state: MinderState; sel: Selection | null; now: number; onSelect: (s: Selection | null) => void }) {
  const sessions = Object.values(state.sessions);
  const row = (a: Agent, name: string, s: Selection, selected: boolean, kind: 'session' | 'subagent') => (
    <button
      className={`lc-row lc-${kind} st-${a.state}${selected ? ' selected' : ''}`}
      aria-label={`${kind} ${name} ${STATE_LABEL[a.state]}`}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(s);
      }}
    >
      <span className="code">
        <b>{lcarsCode(a.id)}</b>
      </span>
      <svg className="reticle" viewBox="-20 -20 40 40" aria-hidden>
        <Glyph state={a.state} r={8} />
      </svg>
      <span className="who">{name}</span>
      <span className="state">{STATE_LABEL[a.state]}</span>
      <span className="what">{a.state === 'TOOL' && a.tool ? `${a.tool.name} ${a.tool.summary}` : ''}</span>
      <span className={`act${isActive(a.state) ? ' live' : ''}`} aria-hidden>
        {Array.from({ length: BAR_SEGMENTS }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </span>
      <span className="since">{formatDuration(now - a.stateSince)}</span>
    </button>
  );

  return (
    <div className="lcars" onClick={() => onSelect(null)}>
      {sessions.length === 0 && <Empty />}
      {sessions.map((s) => {
        const subs = Object.values(s.subagents);
        return (
          <section key={s.id} className={`lc-block elbows st-${s.state}`}>
            {row(s, basename(s.cwd) || shortId(s.id), { sessionId: s.id }, sel?.sessionId === s.id && !sel.agentId, 'session')}
            {subs.length > 0 && (
              <ul>
                {subs.map((a) => (
                  <li key={a.id}>{row(a, a.agentType ?? shortId(a.id), { sessionId: s.id, agentId: a.id }, sel?.agentId === a.id, 'subagent')}</li>
                ))}
              </ul>
            )}
            <footer className="tag">
              SID {shortId(s.id)} <span className="dim">// {subs.length} SUB</span>
            </footer>
          </section>
        );
      })}
    </div>
  );
}

export const Empty = () => (
  <p className="lc-empty">
    <i />
    <span>NO CONTACTS // AWAITING HOOK TRAFFIC</span>
    <i />
  </p>
);
