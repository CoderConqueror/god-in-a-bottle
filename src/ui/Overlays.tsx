import { useRef, useState } from 'react';
import { game, useGame } from '../state/store';
import { finalSummary } from '../sim/chronicle';
import { yearOf } from '../sim/types';

// ------------------------------------------------------------- Onboarding

const SLIDES = [
  {
    title: 'There is an island in this bottle.',
    body: 'Twenty settlers have just come ashore. Over two hundred years they will farm, build, invent, believe, quarrel, and die — entirely on their own. You cannot move them. You cannot command them. You were never asked for.',
  },
  {
    title: 'You are not their ruler. You are their weather.',
    body: 'You hold a slow-refilling pool of Influence. Spend it on interventions — a blessed harvest, a drought, an eclipse, a plague, a dream slipped into a sleeping mind. Every act has a cost, a cooldown, and consequences that arrive decades late.',
  },
  {
    title: 'They will try to explain you.',
    body: 'Act in patterns and the island will notice. Gods will be named for what you do. Rituals, taboos, prophecies, schisms — their theology is built from your fingerprints, and it will steer their history: who they marry, where they settle, whom they fight.',
  },
  {
    title: 'Observe. Interpret. Intervene. Wait.',
    body: 'Click anything inside the bottle to study it. Read the Chronicle. Watch the Mythology panel — it is the story of how they slowly built an understanding of you. The same seed always makes the same world; a new seed makes a new one. Begin.',
  },
];

export function Onboarding(): JSX.Element | null {
  useGame();
  const [i, setI] = useState(0);
  if (!game.showOnboarding) return null;
  const s = SLIDES[i];
  return (
    <div className="overlay">
      <div className="card onboarding">
        <div className="card-kicker">God in a Bottle</div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <div className="dots">{SLIDES.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="card-actions">
          <button className="ghost" onClick={() => game.closeOnboarding()}>Skip</button>
          {i < SLIDES.length - 1
            ? <button className="primary" onClick={() => setI(i + 1)}>Next</button>
            : <button className="primary" onClick={() => { game.closeOnboarding(); game.play(); }}>Lift the veil</button>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Final summary

export function Summary(): JSX.Element | null {
  useGame();
  if (!game.showSummary || !game.st.ended) return null;
  const paras = finalSummary(game.st);
  return (
    <div className="overlay">
      <div className="card summary">
        <div className="card-kicker">The chronicle closes</div>
        <h2>{game.st.worldName}, after {Math.min(200, yearOf(game.st.tick))} years</h2>
        <div className="summary-body">
          {paras.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="card-actions">
          <button className="ghost" onClick={() => game.setShowSummary(false)}>Study the remains</button>
          <button className="ghost" onClick={() => game.restart()}>Same seed again</button>
          <button className="primary" onClick={() => game.newWorld()}>New random world</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Saves modal

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SavesModal(): JSX.Element | null {
  useGame();
  const fileRef = useRef<HTMLInputElement>(null);
  if (game.modal !== 'saves') return null;
  const slots = [1, 2, 3];
  const auto = game.slotMeta(0);
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) game.setModal('none'); }}>
      <div className="card saves">
        <div className="card-kicker">The archive</div>
        <h2>Worlds preserved in glass</h2>
        <div className="slot autosave">
          <div className="slot-info">
            <b>Autosave</b>
            {auto ? <span className="muted"> — {auto.name} · year {auto.year} · {fmtDate(auto.savedAt)}</span> : <span className="muted"> — empty</span>}
          </div>
          <div className="slot-actions">
            {auto && <button onClick={() => { game.loadFrom(0); game.setModal('none'); }}>Load</button>}
          </div>
        </div>
        {slots.map(n => {
          const meta = game.slotMeta(n);
          return (
            <div key={n} className="slot">
              <div className="slot-info">
                <b>Slot {n}</b>
                {meta ? <span className="muted"> — {meta.name} · {fmtDate(meta.savedAt)}</span> : <span className="muted"> — empty</span>}
              </div>
              <div className="slot-actions">
                <button onClick={() => game.saveTo(n)}>Save</button>
                {meta && <button onClick={() => { game.loadFrom(n); game.setModal('none'); }}>Load</button>}
                {meta && <button className="danger" onClick={() => game.deleteSlot(n)}>Delete</button>}
              </div>
            </div>
          );
        })}
        <div className="slot io">
          <div className="slot-info"><b>Beyond the shelf</b><span className="muted"> — a world as a file</span></div>
          <div className="slot-actions">
            <button onClick={() => game.exportSave()}>Export JSON</button>
            <button onClick={() => fileRef.current?.click()}>Import JSON</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { game.importSave(f); game.setModal('none'); }
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <div className="card-actions">
          <button className="primary" onClick={() => game.setModal('none')}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Seed modal

export function SeedModal(): JSX.Element | null {
  useGame();
  const [seed, setSeed] = useState('');
  if (game.modal !== 'seed') return null;
  const go = () => {
    if (seed.trim()) {
      game.pause();
      game.newWorld(seed.trim());
      game.setModal('none');
      setSeed('');
    }
  };
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) game.setModal('none'); }}>
      <div className="card seedcard">
        <div className="card-kicker">Determinism, bottled</div>
        <h2>Speak a world into being</h2>
        <p className="muted">Any phrase becomes an island. The same phrase always becomes the same island — geography, names, weather and all. Only your interventions make one telling differ from another.</p>
        <input
          className="seed-input"
          value={seed}
          autoFocus
          placeholder="e.g. the salt roads of my grandmother"
          onChange={e => setSeed(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') go(); }}
        />
        <div className="card-actions">
          <button className="ghost" onClick={() => game.setModal('none')}>Cancel</button>
          <button className="primary" onClick={go} disabled={!seed.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Toast

export function Toast(): JSX.Element | null {
  useGame();
  if (!game.toastMsg) return null;
  return <div className="toast" key={game.toastMsg.id}>{game.toastMsg.text}</div>;
}
