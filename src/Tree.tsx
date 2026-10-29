import type { Agent, MinderState } from '../shared/state.ts';
import { Glyph } from './Glyph.tsx';
import { Empty } from './Lcars.tsx';
import { basename, formatDuration, shortId, STATE_LABEL, type Selection } from './ui.ts';

export function Tree({ state, sel, now, onSelect }: { state: MinderState; sel: Selection | null; now: number; onSelect: (s: Selection) => void }) {
  const sessions = Object.values(state.sessions);
  const row = (a: Agent, title: string, s: Selection, selected: boolean) => (
    <button className={`row st-${a.state}${selected ? ' selected' : ''}`} onClick={() => onSelect(s)}>
      <svg className="reticle" viewBox="-20 -20 40 40" aria-hidden>
        <Glyph state={a.state} r={8} />
      </svg>
      <span className="who">{title}</span>
      <span className="state">{STATE_LABEL[a.state]}</span>
      <span className="what">{a.tool ? `${a.tool.name} ${a.tool.summary}` : ''}</span>
      <span className="since">{formatDuration(now - a.stateSince)}</span>
    </button>
  );

  return (
    <div className="tree">
      {sessions.length === 0 && <Empty />}
      {sessions.map((s) => {
        const subs = Object.values(s.subagents);
        return (
          <section key={s.id} className={`tree-session elbows st-${s.state}`}>
            <header className="tag">
              SID {shortId(s.id)} <span className="dim">{s.cwd}</span>
            </header>
            {row(s, basename(s.cwd) || shortId(s.id), { sessionId: s.id }, sel?.sessionId === s.id && !sel.agentId)}
            {subs.length > 0 && (
              <ul>
                {subs.map((a) => (
                  <li key={a.id}>{row(a, a.agentType ?? shortId(a.id), { sessionId: s.id, agentId: a.id }, sel?.agentId === a.id)}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
