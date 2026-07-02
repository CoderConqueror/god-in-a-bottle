import { useEffect, useMemo, useRef, useState } from 'react';
import { game, useGame } from '../state/store';
import { SEASONS, Settlement, Deity, Myth, idx, yearOf } from '../sim/types';
import { INTERVENTIONS } from '../sim/interventions';
import { capacityOf, TECHS } from '../sim/engine';
import { Charts } from './Charts';

// ---------------------------------------------------------------- shared bits

function Meter({ label, value, hue }: { label: string; value: number; hue: number }): JSX.Element {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `hsl(${hue} 55% 55%)` }} />
      </div>
      <span className="meter-num">{Math.round(value)}</span>
    </div>
  );
}

const EVENT_ICON: Record<string, string> = {
  arrival: '⛵', era: '✦', founding: '⌂', famine: '🌾', plague: '☠', war: '⚔', ruin: '🕯', wonder: '✹',
  tech: '✎', deity: '☀', faith: '✧', prophecy: '◉', schism: '⚡', taboo: '⛔', ritual: '❋',
  divine: '❋', disaster: '🌩', trade: '⇄', leader: '♦', death: '✝', building: '⌂', strife: '🔥', mishap: '·', birth: '·',
};

// ---------------------------------------------------------------- Chronicle

export function ChroniclePanel(): JSX.Element {
  useGame();
  const [majorOnly, setMajorOnly] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const st = game.st;
  const items = useMemo(() => {
    const evs = majorOnly ? st.events.filter(e => e.imp === 3) : st.events.filter(e => e.imp >= 1);
    const recent = evs.slice(-260);
    // weave era headings into the stream, newest first
    const eraOf = (year: number) => {
      let cur = st.eras[0];
      for (const e of st.eras) if (e.startYear <= year) cur = e;
      return cur;
    };
    const out: ({ kind: 'event'; e: typeof recent[number] } | { kind: 'era'; name: string; note: string })[] = [];
    let lastEra: string | null = null;
    for (const e of recent) {
      const era = eraOf(e.year);
      if (era && era.name !== lastEra) {
        out.push({ kind: 'era', name: era.name, note: era.note });
        lastEra = era.name;
      }
      out.push({ kind: 'event', e });
    }
    return out.reverse();
  }, [st.events.length, majorOnly, st.tick]);

  useEffect(() => {
    if (game.focusEventId !== null && listRef.current) {
      const el = listRef.current.querySelector(`[data-eid="${game.focusEventId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [game.focusEventId]);

  return (
    <div className="panel-inner">
      <div className="panel-tools">
        <span className="muted small">{st.events.length} entries</span>
        <button className={`chip ${majorOnly ? 'on' : ''}`} onClick={() => setMajorOnly(!majorOnly)}>Major only</button>
      </div>
      <div className="scroll-list" ref={listRef}>
        {items.map((it, i) => it.kind === 'era' ? (
          <div key={`era-${it.name}-${i}`} className="era-heading" title={it.note}>
            <span className="era-rule" />{it.name}<span className="era-rule" />
          </div>
        ) : (
          <div
            key={it.e.id}
            data-eid={it.e.id}
            className={`event imp${it.e.imp} ${game.focusEventId === it.e.id ? 'focused' : ''}`}
            onClick={() => { if (it.e.sid !== null) game.select({ kind: 'settlement', sid: it.e.sid }); }}
          >
            <div className="event-head">
              <span className="event-icon">{EVENT_ICON[it.e.type] ?? '·'}</span>
              <span className="event-when">Year {it.e.year}, {SEASONS[it.e.season]}</span>
            </div>
            <div className="event-text">{it.e.text}</div>
          </div>
        ))}
        {items.length === 0 && <div className="empty">History has not happened yet.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Mythology

function temperament(d: Deity): string {
  if (d.grace > d.wrath * 1.6) return 'remembered as kind';
  if (d.wrath > d.grace * 1.6) return 'remembered with fear';
  return 'both feared and thanked';
}

const KIND_LABEL: Record<Myth['kind'], string> = {
  myth: 'Myth', legend: 'Legend', ritual: 'Rite', taboo: 'Taboo', prophecy: 'Prophecy',
  festival: 'Festival', schism: 'Schism', cult: 'Cult',
};

export function MythPanel(): JSX.Element {
  useGame();
  const st = game.st;
  const myths = st.myths.slice().reverse();
  return (
    <div className="panel-inner">
      <div className="scroll-list">
        {st.deities.length === 0 && st.myths.length === 0 && (
          <div className="empty">
            No gods yet. No stories.<br /><br />
            They explain the world with weather and luck — for now. Act in patterns, and they will begin to explain the world with <em>you</em>.
          </div>
        )}
        {st.deities.map(d => (
          <div key={d.id} className={`deity-card ${d.faded ? 'faded' : ''}`}>
            <div className="deity-name">{d.name}</div>
            <div className="deity-title">{d.title} · sovereign of {d.domain}</div>
            <div className="deity-bar">
              <div className="deity-grace" style={{ width: `${(d.grace / Math.max(1, d.grace + d.wrath)) * 100}%` }} />
            </div>
            <div className="deity-meta">
              <span>{temperament(d)}</span>
              <span>{d.faded ? 'forgotten' : `worship ${Math.round(d.worship)}`}</span>
              <span>since year {d.year}</span>
            </div>
          </div>
        ))}
        {myths.map(m => {
          const deity = st.deities.find(d => d.id === m.deityId);
          const status = m.kind === 'prophecy'
            ? (m.data?.fulfilled === true ? ' — fulfilled' : m.data?.fulfilled === false ? ' — failed' : ' — awaited')
            : '';
          return (
            <div key={m.id} className={`myth kind-${m.kind}`}>
              <div className="myth-head">
                <span className="myth-kind">{KIND_LABEL[m.kind]}{status}</span>
                <span className="myth-when">Year {m.year}{deity ? ` · ${deity.name}` : ''}</span>
              </div>
              <div className="myth-title">{m.title}</div>
              <div className="myth-text">{m.text}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Interventions

const DOMAIN_HUE: Record<string, number> = { harvest: 42, storm: 205, death: 285, sky: 225, wisdom: 175, earth: 95 };
const TARGET_WORD: Record<string, string> = { settlement: 'one settlement', tile: 'chosen ground', global: 'the whole world' };

export function InterventionPanel(): JSX.Element {
  useGame();
  const [hovered, setHovered] = useState<string | null>(null);
  const st = game.st;
  const focus = INTERVENTIONS.find(d => d.id === (game.targeting ?? hovered));
  return (
    <div className="panel-inner ivn-panel">
      <div className="interventions">
        {INTERVENTIONS.map(def => {
          const cdUntil = st.cooldowns[def.id] ?? 0;
          const onCd = cdUntil > st.tick;
          const cdYears = Math.ceil((cdUntil - st.tick) / 4);
          const cdFrac = onCd ? (cdUntil - st.tick) / (def.cooldownYears * 4) : 0;
          const poor = st.influence < def.cost;
          const armed = game.targeting === def.id;
          const disabled = st.ended || onCd || poor;
          const hue = DOMAIN_HUE[def.domain] ?? 40;
          return (
            <button
              key={def.id}
              className={`ivn ${armed ? 'armed' : ''} ${disabled ? 'disabled' : ''}`}
              style={{ ['--hue' as string]: hue, ['--cd' as string]: `${Math.round(cdFrac * 360)}deg` }}
              onClick={() => !disabled && game.beginIntervention(def.id)}
              onMouseEnter={() => setHovered(def.id)}
              onMouseLeave={() => setHovered(h => (h === def.id ? null : h))}
            >
              <span className={`ivn-sigil ${onCd ? 'cooling' : ''}`}>
                <span className="ivn-icon">{def.icon}</span>
              </span>
              <span className="ivn-name">{def.name}</span>
              <span className="ivn-cost">{onCd ? `${cdYears}y` : `◈ ${def.cost}`}</span>
            </button>
          );
        })}
      </div>
      <div className="ivn-preview">
        {game.targeting && focus ? (
          <>
            <div className="ivn-preview-title">{focus.icon}&ensp;{focus.name} <span className="muted">— your hand hovers</span></div>
            <div className="ivn-preview-body"><b>Click the world</b> to act, or click the sigil again to withhold.</div>
          </>
        ) : focus ? (
          <>
            <div className="ivn-preview-title">{focus.icon}&ensp;{focus.name}
              <span className="ivn-preview-meta">◈ {focus.cost} · rests {focus.cooldownYears}y · {TARGET_WORD[focus.target]}</span>
            </div>
            <div className="ivn-preview-body">{focus.desc}</div>
            <div className="ivn-preview-whisper">{focus.whisper} Echoes for decades.</div>
          </>
        ) : (
          <div className="ivn-preview-body muted">
            Interventions are never orders — they are weather, luck, dreams. Raw material for whatever the mortals decide it meant.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Divine Ledger

export function LedgerPanel(): JSX.Element {
  useGame();
  const st = game.st;
  const entries = st.ledger.slice().reverse();
  return (
    <div className="panel-inner">
      <div className="scroll-list">
        {entries.length === 0 && (
          <div className="empty">
            The ledger is blank.<br /><br />
            Every act of yours will be written here in two hands: what you did, and what they decided it meant. The distance between those lines is the whole game.
          </div>
        )}
        {entries.map(le => (
          <div key={le.id} className="ledger-entry">
            <div className="ledger-act">
              <span className="ledger-icon">{le.icon}</span>
              <div>
                <div className="ledger-what">You {ledgerVerb(le.action)} <b>{le.targetName}</b></div>
                <div className="ledger-when">Year {le.year}</div>
              </div>
            </div>
            <div className={`ledger-belief ${le.interpretation ? '' : 'pending'}`}>
              {le.interpretation ?? 'No one has explained it — yet.'}
            </div>
            {le.echoes.map((ec, i) => (
              <div key={i} className="ledger-echo">↳ {ec}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ledgerVerb(action: string): string {
  const m: Record<string, string> = {
    'Omen': 'sent an omen over', 'Rain': 'opened the sky above', 'Bless Harvest': 'blessed the fields of',
    'Curse': 'laid a curse on', 'Drought': 'sealed the sky above', 'Inspire Leader': 'kindled a mind in',
    'Eclipse': 'swallowed the sun above', 'Consecrate Land': 'hallowed', 'Miracle': 'worked a miracle in',
    'Reveal Knowledge': 'slipped knowledge into', 'Plague': 'sent the pale visitor to', 'Comet': 'wrote fire across',
  };
  return m[action] ?? 'touched';
}

// ---------------------------------------------------------------- Inspector

function SettlementInspector({ s }: { s: Settlement }): JSX.Element {
  const st = game.st;
  const deity = st.deities.find(d => d.id === s.patron);
  const leader = st.people.find(p => p.id === s.leader);
  const notable = st.people
    .filter(p => p.home === s.id && p.renown > 4)
    .sort((a, b) => b.renown - a.renown)
    .slice(0, 4);
  const relations = Object.entries(s.relations)
    .map(([oid, v]) => ({ o: st.settlements.find(x => x.id === +oid), v }))
    .filter(r => r.o && !r.o.razed) as { o: Settlement; v: number }[];
  const localEvents = s.localHistory
    .map(id => st.events.find(e => e.id === id))
    .filter(Boolean)
    .slice(-5)
    .reverse();
  const cap = Math.round(capacityOf(st, s));
  return (
    <div className="scroll-list inspector">
      <div className="insp-title">{s.name}</div>
      <div className="insp-sub">
        {s.faction} · founded year {s.founded}
        {deity && <> · keeps {deity.name}{s.sect ? ` (${s.sect})` : ''}</>}
      </div>
      <div className="insp-sub muted">
        {s.pop} souls of ~{cap} the land can hold
        {s.warWith !== null && <span className="warn"> · AT WAR</span>}
        {s.plague > 0 && <span className="warn"> · plague</span>}
        {s.hunger >= 2 && <span className="warn"> · famine</span>}
        {s.blessed > 0 && <span className="bless"> · blessed</span>}
        {s.cursed > 0 && <span className="warn"> · cursed</span>}
      </div>
      <Meter label="Food" value={(s.food / Math.max(1, s.pop * 2.5)) * 100} hue={45} />
      <Meter label="Morale" value={s.morale} hue={35} />
      <Meter label="Faith" value={s.faith} hue={195} />
      <Meter label="Cohesion" value={s.cohesion} hue={135} />
      <Meter label="Health" value={s.health} hue={0} />
      <div className="insp-row">
        <span>wood {Math.round(s.wood)}</span>
        <span>stone {Math.round(s.stone)}</span>
        <span>knowledge {Math.round(s.knowledge)}</span>
      </div>
      {Object.keys(s.buildings).length > 0 && (
        <div className="insp-block">
          <div className="insp-h">Built</div>
          <div className="insp-tags">
            {Object.entries(s.buildings).filter(([, n]) => n > 0).map(([b, n]) => (
              <span key={b} className="tag">{b}{n > 1 ? ` ×${n}` : ''}</span>
            ))}
          </div>
        </div>
      )}
      <div className="insp-block">
        <div className="insp-h">They prize</div>
        <div className="insp-tags">{s.culture.map(c => <span key={c} className="tag">{c}</span>)}</div>
      </div>
      {(leader || notable.length > 0) && (
        <div className="insp-block">
          <div className="insp-h">Notable souls</div>
          {leader && <div className="person"><b>{leader.name}</b> — speaks for the settlement, age {Math.floor(leader.age)}{leader.traits.length ? `, ${leader.traits.join(' and ')}` : ''}</div>}
          {notable.filter(p => p.id !== s.leader).map(p => (
            <div key={p.id} className="person">
              <b>{p.name}</b> — {p.prof}, age {Math.floor(p.age)}
              {p.memories.length > 0 && <span className="muted"> · {p.memories[p.memories.length - 1]}</span>}
            </div>
          ))}
        </div>
      )}
      {relations.length > 0 && (
        <div className="insp-block">
          <div className="insp-h">Neighbors</div>
          {relations.map(r => (
            <div key={r.o.id} className="relation" onClick={() => game.select({ kind: 'settlement', sid: r.o.id })}>
              <span>{r.o.name}</span>
              <span className={r.v > 15 ? 'good' : r.v < -15 ? 'bad' : 'muted'}>
                {s.warWith === r.o.id ? 'at war' : r.v > 30 ? 'fast friends' : r.v > 10 ? 'friendly' : r.v < -30 ? 'hated' : r.v < -10 ? 'wary' : 'distant'}
              </span>
            </div>
          ))}
        </div>
      )}
      {localEvents.length > 0 && (
        <div className="insp-block">
          <div className="insp-h">Local memory</div>
          {localEvents.map(e => e && (
            <div key={e.id} className="local-event" onClick={() => game.focusEvent(e.id)}>
              <span className="muted">Y{e.year}</span> {e.text.length > 90 ? e.text.slice(0, 90) + '…' : e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TileInspector({ x, y }: { x: number; y: number }): JSX.Element {
  const st = game.st;
  const t = st.tiles[idx(st, x, y)];
  const site = t.sacredId !== null ? st.sacred.find(s => s.id === t.sacredId) : null;
  const NAMES: Record<string, string> = {
    ocean: 'Open water', coast: 'Shoreline', plain: 'Open grassland', forest: 'Old forest',
    hills: 'Rolling hills', mountain: 'Bare mountain', dry: 'Dry scrubland',
  };
  return (
    <div className="scroll-list inspector">
      <div className="insp-title">{NAMES[t.t]}</div>
      <div className="insp-sub muted">({x}, {y})</div>
      {t.river && <div className="insp-sub">A river runs through it.</div>}
      {t.t !== 'ocean' && <Meter label="Fertility" value={(t.fert / 1.4) * 100} hue={90} />}
      {site && (
        <div className="insp-block">
          <div className="insp-h">Sacred ground</div>
          <div>{site.name}{site.year > 0 ? `, hallowed in year ${site.year}` : ', older than memory'}.</div>
        </div>
      )}
      {t.ruinName && (
        <div className="insp-block">
          <div className="insp-h">Ruins</div>
          <div>Here stood {t.ruinName}. Fire-blackened stones; nettles in the doorways.</div>
        </div>
      )}
    </div>
  );
}

function WorldInspector(): JSX.Element {
  const st = game.st;
  const living = st.settlements.filter(s => !s.razed);
  return (
    <div className="scroll-list inspector">
      <div className="insp-title">{st.worldName}</div>
      <div className="insp-sub muted">seed {st.seed} · {st.people.length} souls · {living.length} settlement{living.length === 1 ? '' : 's'}</div>
      <div className="insp-block">
        <div className="insp-h">Settlements</div>
        {living.map(s => (
          <div key={s.id} className="relation" onClick={() => game.select({ kind: 'settlement', sid: s.id })}>
            <span>{s.name}</span>
            <span className="muted">{s.pop} souls</span>
          </div>
        ))}
        {living.length === 0 && <div className="muted">None remain.</div>}
      </div>
      {Object.keys(st.techs).length > 0 && (
        <div className="insp-block">
          <div className="insp-h">Arts mastered</div>
          <div className="insp-tags">
            {TECHS.filter(t => st.techs[t.id] !== undefined).map(t => (
              <span key={t.id} className="tag" title={`${t.desc} (year ${st.techs[t.id]})`}>{t.name}</span>
            ))}
          </div>
        </div>
      )}
      <div className="insp-block muted small">
        Click a settlement or any ground inside the bottle to study it.
      </div>
    </div>
  );
}

export function Inspector(): JSX.Element {
  useGame();
  const sel = game.selection;
  const st = game.st;
  if (sel.kind === 'settlement') {
    const s = st.settlements.find(x => x.id === sel.sid);
    if (s && !s.razed) return <SettlementInspector s={s} />;
  }
  if (sel.kind === 'tile' && sel.x !== undefined && sel.y !== undefined) {
    return <TileInspector x={sel.x} y={sel.y} />;
  }
  return <WorldInspector />;
}

// ---------------------------------------------------------------- Left column

export function LeftColumn(): JSX.Element {
  useGame();
  const tab = game.leftTab;
  return (
    <aside className="col left-col">
      <div className="tabs">
        <button className={tab === 'chronicle' ? 'on' : ''} onClick={() => game.setLeftTab('chronicle')}>Chronicle</button>
        <button className={tab === 'myths' ? 'on' : ''} onClick={() => game.setLeftTab('myths')}>Mythology</button>
        <button className={tab === 'ledger' ? 'on' : ''} onClick={() => game.setLeftTab('ledger')}>Ledger</button>
        <button className={tab === 'charts' ? 'on' : ''} onClick={() => game.setLeftTab('charts')}>Histories</button>
      </div>
      {tab === 'chronicle' && <ChroniclePanel />}
      {tab === 'myths' && <MythPanel />}
      {tab === 'ledger' && <LedgerPanel />}
      {tab === 'charts' && <Charts />}
    </aside>
  );
}

// ---------------------------------------------------------------- Right column

export function RightColumn(): JSX.Element {
  useGame();
  return (
    <aside className="col right-col">
      <div className="col-head">Divine Hand</div>
      <InterventionPanel />
      <div className="col-head">Inspector</div>
      <Inspector />
    </aside>
  );
}
