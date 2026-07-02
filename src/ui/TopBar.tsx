import { game, useGame, SPEEDS } from '../state/store';
import { SEASONS, yearOf, seasonOf } from '../sim/types';
import { currentEra } from '../sim/chronicle';

export function TopBar(): JSX.Element {
  useGame();
  const st = game.st;
  const year = yearOf(st.tick);
  const season = SEASONS[seasonOf(st.tick)];
  const pct = (st.influence / st.influenceMax) * 100;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-title">God in a Bottle</span>
        <span className="brand-world">{st.worldName} <span className="muted">· seed {st.seed}</span></span>
      </div>

      <div className="clock">
        <div className="clock-year">Year {Math.min(year, 200)} <span className="clock-season">· {season}</span></div>
        <div className="clock-era">{currentEra(st)}</div>
      </div>

      <div className="influence" title="Influence — spent on interventions, restored by time and worship (shrines and temples quicken it).">
        <div className="orb">
          <div className="orb-fill" style={{ height: `${pct}%` }} />
          <span className="orb-num">{Math.floor(st.influence)}</span>
        </div>
        <span className="orb-label">influence</span>
      </div>

      <div className="controls">
        <button className="ctl big" onClick={() => game.toggle()} title={game.running ? 'Pause (space)' : 'Play (space)'}>
          {game.running ? '❚❚' : '▶'}
        </button>
        {SPEEDS.map((s, i) => (
          <button key={s.label} className={`ctl ${game.speedIdx === i ? 'on' : ''}`} onClick={() => game.setSpeed(i)}>{s.label}</button>
        ))}
        <button className="ctl" onClick={() => game.stepYear()} title="Advance one year">+1y</button>
        {st.ended && <button className="ctl accent" onClick={() => game.setShowSummary(true)}>Summary</button>}
        <span className="ctl-sep" />
        <button className="ctl" onClick={() => game.setModal('saves')} title="Save, load, export, import">Saves</button>
        <button className="ctl" onClick={() => game.setModal('seed')} title="Begin a world from a chosen seed">Seed…</button>
        <button className="ctl" onClick={() => { game.pause(); game.restart(); }} title="Replay this same world from year 1">Restart</button>
        <button className="ctl accent" onClick={() => { game.pause(); game.newWorld(); }} title="A fresh island, a fresh people">New World</button>
        <span className="ctl-sep" />
        <button className="ctl" onClick={() => game.toggleMute()} title={game.muted ? 'Unmute ambience' : 'Mute ambience'}>{game.muted ? '🔇' : '🔊'}</button>
        <button className="ctl" onClick={() => game.openOnboarding()} title="What is this?">?</button>
      </div>
    </header>
  );
}
