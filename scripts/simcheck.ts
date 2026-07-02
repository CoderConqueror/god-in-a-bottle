// Headless harness: runs full 200-year simulations to sanity-check balance and determinism.
import { newSim, simTick } from '../src/sim/engine';
import { applyIntervention } from '../src/sim/interventions';

function run(seed: string, intervene: boolean) {
  const st = newSim(seed);
  for (let t = 0; t < 4800 && !st.ended; t++) {
    simTick(st);
    if (intervene && t % 600 === 240) {
      const liv = st.settlements.filter(s => !s.razed);
      const order = ['bless', 'rain', 'eclipse', 'inspire', 'comet', 'plague', 'miracle', 'consecrate'];
      const id = order[Math.floor(t / 600) % order.length];
      if (id === 'consecrate') applyIntervention(st, id, { x: liv[0] ? liv[0].x + 4 : 30, y: liv[0] ? liv[0].y : 30 });
      else if (['rain', 'eclipse', 'comet'].includes(id)) applyIntervention(st, id);
      else if (liv[0]) applyIntervention(st, id, { sid: liv[0].id });
    }
  }
  return st;
}

const seeds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
for (const seed of seeds) {
  for (const iv of [false, true]) {
    const st = run(seed, iv);
    console.log(
      `${seed}${iv ? '+iv' : '   '} y${Math.floor(st.tick / 4) + 1}`.padEnd(18),
      `pop=${st.people.length}`.padEnd(9),
      `setts=${st.settlements.filter(s => !s.razed).length}/${st.settlements.length}`.padEnd(11),
      `deities=${st.deities.length}`.padEnd(10),
      `myths=${st.myths.length}`.padEnd(10),
      `techs=${Object.keys(st.techs).length}`.padEnd(9),
      `wars=${st.stats.wars}`.padEnd(7),
      `events=${st.events.length}`.padEnd(11),
      `eras=${st.eras.length}`,
      `peak=${st.stats.peakPop}`,
      `roads=${st.roads.length}`,
      `scars=${st.scars.length}`,
      `faded=${st.deities.filter(d => d.faded).length}`,
      `ledger=${st.ledger.length}`,
      st.endText ?? '',
    );
  }
}

// determinism: same seed, no interventions -> identical outcomes
const a = run('determinism-check', false);
const b = run('determinism-check', false);
const sigA = JSON.stringify({ p: a.people.length, e: a.events.length, m: a.myths.map(m => m.title), s: a.stats });
const sigB = JSON.stringify({ p: b.people.length, e: b.events.length, m: b.myths.map(m => m.title), s: b.stats });
console.log('\ndeterminism:', sigA === sigB ? 'OK — identical worlds from identical seed' : 'FAILED');

// divergence: different seeds should differ
const c = run('another-seed', false);
console.log('seed variety:', a.worldName !== c.worldName || a.people.length !== c.people.length ? `OK (${a.worldName} vs ${c.worldName})` : 'SUSPICIOUS');

// save roundtrip: state survives JSON serialization
const json = JSON.stringify(a);
const back = JSON.parse(json);
console.log('serialization:', back.people.length === a.people.length && back.rng.a === a.rng.a ? 'OK' : 'FAILED');
