import { useMemo } from 'react';
import { game, useGame } from '../state/store';
import { END_YEAR } from '../sim/types';

const W = 300, H = 130, PAD = 6;

interface Series { key: 'pop' | 'faith' | 'settlements' | 'knowledge'; label: string; color: string; norm?: number }

function Line({ data, max, color }: { data: number[]; max: number; color: string }): JSX.Element {
  if (data.length < 2) return <g />;
  const pts = data.map((v, i) => {
    const x = PAD + (i / Math.max(1, data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (v / Math.max(1, max)) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />;
}

function Chart({ title, values, color, note }: { title: string; values: number[]; color: string; note?: string }): JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <div className="chart">
      <div className="chart-head">
        <span>{title}</span>
        <span className="muted">{values.length ? Math.round(values[values.length - 1]) : 0}{note}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect x="0" y="0" width={W} height={H} fill="rgba(10,14,26,0.5)" rx="6" />
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H - PAD - f * (H - PAD * 2)} y2={H - PAD - f * (H - PAD * 2)} stroke="rgba(200,200,220,0.08)" />
        ))}
        <Line data={values} max={max} color={color} />
      </svg>
    </div>
  );
}

export function Charts(): JSX.Element {
  useGame();
  const st = game.st;
  const h = st.history;
  const series = useMemo(() => ({
    pop: h.map(s => s.pop),
    faith: h.map(s => s.faith),
    know: h.map(s => s.knowledge),
    war: h.map(s => s.warDeaths),
    setts: h.map(s => s.settlements),
    food: h.map(s => s.food),
  }), [h.length]);

  return (
    <div className="panel-inner">
      <div className="scroll-list charts">
        {h.length < 2 ? (
          <div className="empty">Let a few winters pass; the lines will draw themselves.</div>
        ) : (
          <>
            <Chart title="Population" values={series.pop} color="#e8c176" />
            <Chart title="Faith" values={series.faith} color="#7fd4e8" />
            <Chart title="Knowledge" values={series.know} color="#b48fe0" />
            <Chart title="Stored food" values={series.food} color="#8fce7a" />
            <Chart title="War dead (total)" values={series.war} color="#e07a6a" />
            <Chart title="Settlements" values={series.setts} color="#d8b8a0" />
          </>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------- Era timeline strip

export function Timeline(): JSX.Element {
  useGame();
  const st = game.st;
  const curYear = Math.floor(st.tick / 4) + 1;
  const span = END_YEAR;
  // turning points, not marker soup: if history runs long, keep only the hinges
  let majors = st.events.filter(e => e.imp === 3);
  if (majors.length > 70) {
    const hinge = new Set(['era', 'deity', 'wonder', 'schism', 'ruin', 'prophecy', 'arrival']);
    const hinges = majors.filter(e => hinge.has(e.type));
    const rest = majors.filter(e => !hinge.has(e.type));
    const budget = Math.max(0, 70 - hinges.length);
    const stride = Math.ceil(rest.length / Math.max(1, budget));
    majors = [...hinges, ...rest.filter((_, i) => i % stride === 0)].sort((a, b) => a.tick - b.tick);
  }
  return (
    <div className="timeline">
      <div className="timeline-track">
        {st.eras.map((era, i) => {
          const end = i + 1 < st.eras.length ? st.eras[i + 1].startYear : Math.max(curYear, era.startYear + 1);
          const left = ((era.startYear - 1) / span) * 100;
          const width = ((end - era.startYear) / span) * 100;
          return (
            <div
              key={era.name}
              className={`era-band band${i % 4}`}
              style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }}
              title={`${era.name} (from year ${era.startYear}) — ${era.note}`}
            >
              <span className="era-name">{era.name}</span>
            </div>
          );
        })}
        {majors.map(e => (
          <button
            key={e.id}
            className={`era-mark mark-${e.type}`}
            style={{ left: `${((e.year - 1) / span) * 100}%` }}
            title={`Year ${e.year}: ${e.text}`}
            onClick={() => game.focusEvent(e.id)}
          />
        ))}
        <div className="timeline-now" style={{ left: `${Math.min(100, ((curYear - 1) / span) * 100)}%` }} />
      </div>
      <div className="timeline-scale">
        <span>Year 1</span>
        <span>{Math.round(span / 4)}</span>
        <span>{Math.round(span / 2)}</span>
        <span>{Math.round((span * 3) / 4)}</span>
        <span>{span}</span>
      </div>
    </div>
  );
}
