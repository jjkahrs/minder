import type { MinderState } from '../shared/state.ts';
import { Glyph } from './Glyph.tsx';
import { basename, orbitPos, orbitRadius, sessionPos, shortId, STATE_LABEL, type Selection } from './ui.ts';

// Off-center radar: the center sits left/below the viewBox middle so the floating
// detail panel overlaps empty sky on the right.
const W = 1200, H = 800, CX = 470, CY = 450, R = 330;
const SWEEP_SLICES = 14; // fading wedges trailing the sweep line

export function Radar({ state, sel, onSelect }: { state: MinderState; sel: Selection | null; onSelect: (s: Selection | null) => void }) {
  const sessions = Object.values(state.sessions);
  const pick = (s: Selection) => (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onSelect(s);
  };
  const keyPick = (s: Selection) => (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && pick(s)(e);

  return (
    <svg className="radar" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid meet" onClick={() => onSelect(null)}>
      <g className="grid">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={CX} cy={CY} r={R * f} />
        ))}
        <line x1={CX - R - 40} x2={CX + R + 160} y1={CY} y2={CY} />
        <line x1={CX} x2={CX} y1={CY - R - 40} y2={CY + R + 30} />
        {Array.from({ length: 72 }, (_, i) => (
          <line key={i} x1={CX + R} x2={CX + R + (i % 3 ? 5 : 11)} y1={CY} y2={CY} transform={`rotate(${i * 5} ${CX} ${CY})`} />
        ))}
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 - 90) * Math.PI) / 180;
          return (
            <text key={i} className="deg" x={CX + (R + 26) * Math.cos(a)} y={CY + (R + 26) * Math.sin(a)} dy="0.35em">
              {String(i * 30).padStart(3, '0')}
            </text>
          );
        })}
        <text className="coord" x={CX + 8} y={CY - 8}>
          ORIGIN 0.000 / 0.000
        </text>
      </g>

      <g className="sweep" style={{ transformOrigin: `${CX}px ${CY}px` }}>
        {Array.from({ length: SWEEP_SLICES }, (_, i) => {
          const a0 = (-i * 3 * Math.PI) / 180, a1 = (-(i + 1) * 3 * Math.PI) / 180;
          return (
            <path
              key={i}
              d={`M${CX} ${CY}L${CX + R * Math.cos(a0)} ${CY + R * Math.sin(a0)}A${R} ${R} 0 0 0 ${CX + R * Math.cos(a1)} ${CY + R * Math.sin(a1)}Z`}
              opacity={0.16 * (1 - i / SWEEP_SLICES)}
            />
          );
        })}
        <line x1={CX} y1={CY} x2={CX + R} y2={CY} />
      </g>

      {sessions.length === 0 && (
        <text className="empty" x={CX} y={CY + R * 0.5}>
          NO CONTACTS // AWAITING HOOK TRAFFIC
        </text>
      )}

      {sessions.map((s, i) => {
        const p = sessionPos(i, R);
        const x = CX + p.x, y = CY + p.y;
        const subs = Object.values(s.subagents);
        const orbit = orbitRadius(subs.length);
        const selSession = sel?.sessionId === s.id && !sel.agentId;
        return (
          <g key={s.id} className={`contact st-${s.state}`}>
            {subs.length > 0 && <circle className="orbit" cx={x} cy={y} r={orbit} />}
            {subs.map((a, j) => {
              const q = orbitPos(j, subs.length, orbit);
              const s2: Selection = { sessionId: s.id, agentId: a.id };
              return (
                <g key={a.id} className="node sub" role="button" tabIndex={0} aria-label={`subagent ${a.agentType ?? a.id} ${a.state}`} onClick={pick(s2)} onKeyDown={keyPick(s2)}>
                  <line className="tether" x1={x} y1={y} x2={x + q.x} y2={y + q.y} />
                  <circle className="hit" cx={x + q.x} cy={y + q.y} r={14} />
                  <Glyph state={a.state} x={x + q.x} y={y + q.y} r={6} selected={sel?.agentId === a.id} />
                </g>
              );
            })}
            <g className="node" role="button" tabIndex={0} aria-label={`session ${shortId(s.id)} ${s.state}`} onClick={pick({ sessionId: s.id })} onKeyDown={keyPick({ sessionId: s.id })}>
              <circle className="hit" cx={x} cy={y} r={22} />
              <Glyph state={s.state} x={x} y={y} r={12} selected={selSession} />
              <text className="label" x={x + orbit * (subs.length ? 1 : 0.5) + 14} y={y - 6}>
                {basename(s.cwd) || shortId(s.id)}
              </text>
              <text className={`tag st-${s.state}`} x={x + orbit * (subs.length ? 1 : 0.5) + 14} y={y + 10}>
                {STATE_LABEL[s.state]}
                {s.tool ? ` · ${s.tool.name}` : ''}
                {subs.length ? ` · ${subs.length} SUB` : ''}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
