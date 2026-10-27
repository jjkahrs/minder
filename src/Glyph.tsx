import type { AgentState } from '../shared/state.ts';

// State reticle drawn at (x, y). Shared by the radar and the tree view; color and
// animation come from the `st-<STATE>` class in styles.css (currentColor).
export function Glyph({ state, x = 0, y = 0, r = 10, selected = false }: { state: AgentState; x?: number; y?: number; r?: number; selected?: boolean }) {
  const t = r * 0.45; // bracket arm length
  const b = r * 1.35; // bracket square half-size
  return (
    <g className={`glyph st-${state}`} transform={`translate(${x} ${y})`}>
      {(state === 'WAITING_PERMISSION' || state === 'WAITING_INPUT') && (
        <>
          <circle className="pulse" r={r} />
          <circle className="pulse pulse-2" r={r} />
        </>
      )}
      {state === 'WAITING_PERMISSION' ? (
        // diamond outline distinguishes permission from input at a glance
        <rect className="ring" x={-r} y={-r} width={r * 2} height={r * 2} transform="rotate(45)" />
      ) : (
        <circle className={state === 'THINKING' ? 'ring spin' : 'ring'} r={r} />
      )}
      {state === 'TOOL' && (
        <path
          className="brk"
          d={`M${-b} ${-b + t}V${-b}H${-b + t} M${b - t} ${-b}H${b}V${-b + t} M${b} ${b - t}V${b}H${b - t} M${-b + t} ${b}H${-b}V${b - t}`}
        />
      )}
      {state === 'ERROR' ? (
        <path className="x" d={`M${-r * 0.5} ${-r * 0.5}L${r * 0.5} ${r * 0.5}M${r * 0.5} ${-r * 0.5}L${-r * 0.5} ${r * 0.5}`} />
      ) : state === 'WAITING_PERMISSION' || state === 'WAITING_INPUT' ? (
        <text className="mark" dy="0.36em" fontSize={r * 1.2}>
          {state === 'WAITING_PERMISSION' ? '!' : '?'}
        </text>
      ) : (
        <circle className="core" r={r * 0.38} />
      )}
      {selected && (
        <g className="sel">
          <circle r={r * 2.1} />
          {[0, 90, 180, 270].map((a) => (
            <line key={a} x1={r * 1.8} x2={r * 2.6} transform={`rotate(${a})`} />
          ))}
        </g>
      )}
    </g>
  );
}
