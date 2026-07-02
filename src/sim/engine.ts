import { RNG, seedRng, rnd, ri, pick, chance, shuffled } from './rng';
import {
  SimState, Settlement, Person, Domain, SacredSite,
  yearOf, seasonOf, idx, inBounds, dist, TICKS_PER_YEAR, END_YEAR,
} from './types';
import { generateTerrain, findSettlementSite, scoreSite } from './worldgen';
import { makeCulture, personName, placeName, worldNameGen, pickTraits } from './names';
import { addEvent, pushEra } from './chronicle';
import { recordSignal, religionTick, notifyCondition, maybeTaboo, makeLegend, addMemory } from './myth';

export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------
// Technologies
// ---------------------------------------------------------------------

export interface TechDef { id: string; name: string; cost: number; req?: string; desc: string }
export const TECHS: TechDef[] = [
  { id: 'pottery', name: 'Pottery', cost: 50, desc: 'Sealed jars keep the harvest through winter.' },
  { id: 'weaving', name: 'Weaving', cost: 45, desc: 'Cloth, nets, and warmth against the cold.' },
  { id: 'irrigation', name: 'Irrigation', cost: 65, desc: 'River water led into thirsty fields.' },
  { id: 'sailing', name: 'Sailing', cost: 75, desc: 'The sea becomes a road and a larder.' },
  { id: 'music', name: 'Music', cost: 40, desc: 'Songs that make long winters shorter.' },
  { id: 'writing', name: 'Writing', cost: 130, req: 'pottery', desc: 'Memory that outlives the rememberer.' },
  { id: 'masonry', name: 'Masonry', cost: 115, desc: 'Stone on stone: temples, walls, permanence.' },
  { id: 'calendar', name: 'the Calendar', cost: 120, req: 'writing', desc: 'The year, counted and tamed.' },
  { id: 'medicine', name: 'Medicine', cost: 180, req: 'writing', desc: 'Herbs and setting-bones; fewer graves.' },
  { id: 'bronzework', name: 'Bronzework', cost: 190, req: 'masonry', desc: 'Bright metal for ploughs — and spears.' },
  { id: 'astronomy', name: 'Astronomy', cost: 230, req: 'calendar', desc: 'The sky charted; omens become knowledge.' },
  { id: 'ironwork', name: 'Ironwork', cost: 300, req: 'bronzework', desc: 'Grey metal, cheap and merciless.' },
];

export function hasTech(st: SimState, id: string): boolean {
  return st.techs[id] !== undefined;
}

// ---------------------------------------------------------------------
// World creation
// ---------------------------------------------------------------------

const PROFS = ['farmer', 'fisher', 'forester', 'mason', 'healer', 'priest', 'crafter', 'hunter', 'weaver'];

function newPerson(st: SimState, sex: 'm' | 'f', age: number, home: number): Person {
  const p: Person = {
    id: st.nextId++,
    name: personName(st.rng, st.culture, sex),
    sex, age,
    traits: pickTraits(st.rng),
    prof: age >= 14 ? pick(st.rng, PROFS) : 'child',
    health: ri(st.rng, 70, 95),
    morale: ri(st.rng, 55, 80),
    faith: ri(st.rng, 5, 30),
    home,
    spouse: null,
    renown: 0,
    memories: [],
  };
  st.people.push(p);
  return p;
}

function blankSettlement(st: SimState, x: number, y: number, name: string, faction: string): Settlement {
  const s: Settlement = {
    id: st.nextId++,
    name, x, y,
    founded: yearOf(st.tick),
    faction,
    food: 60, wood: 30, stone: 5, knowledge: 0,
    morale: 60, faith: 15, cohesion: 65, health: 60,
    buildings: {},
    relations: {}, tension: {}, truce: {},
    culture: shuffled(st.rng, st.culture.values).slice(0, 2),
    patron: null, sect: null,
    hunger: 0, plague: 0, blessed: 0, cursed: 0, inspired: 0, boom: 0,
    graceSeen: 0, wrathSeen: 0,
    leader: null,
    warWith: null, warStart: 0,
    lastSplit: st.tick,
    razed: false, razedYear: 0,
    pop: 0,
    taboos: [],
    localHistory: [],
  };
  st.settlements.push(s);
  return s;
}

export function newSim(seed: string): SimState {
  const rng = seedRng(seed);
  const culture = makeCulture(rng);
  const st: SimState = {
    version: SAVE_VERSION,
    seed,
    worldName: worldNameGen(rng, culture),
    rng,
    tick: 0,
    ended: false,
    endText: null,
    W: 64, H: 64,
    tiles: [],
    terrainV: 1,
    sacred: [],
    people: [],
    settlements: [],
    deities: [],
    myths: [],
    events: [],
    eras: [],
    influence: 30,
    influenceMax: 100,
    cooldowns: {},
    delayed: [],
    weather: { rain: 0, drought: 0, eclipse: 0, comet: 0, rainUses: [] },
    signals: {
      harvest: { grace: 0, wrath: 0, count: 0 },
      storm: { grace: 0, wrath: 0, count: 0 },
      death: { grace: 0, wrath: 0, count: 0 },
      sky: { grace: 0, wrath: 0, count: 0 },
      wisdom: { grace: 0, wrath: 0, count: 0 },
      earth: { grace: 0, wrath: 0, count: 0 },
    },
    interventionsUsed: 0,
    usedByKind: {},
    techs: {},
    history: [],
    stats: { born: 0, died: 0, warDeaths: 0, plagueDeaths: 0, famineDeaths: 0, wars: 0, peakPop: 0 },
    nextId: 1,
    culture,
  };
  generateTerrain(st, rng);

  // register any naturally-sacred ground the generator marked
  for (let i = 0; i < st.tiles.length; i++) {
    if (st.tiles[i].sacredId === 0) {
      const site: SacredSite = {
        id: st.nextId++,
        x: i % st.W, y: Math.floor(i / st.W),
        name: `the Standing Stones of ${placeName(st.rng, st.culture)}`,
        year: 0, deityId: null, kind: 'natural',
      };
      st.sacred.push(site);
      st.tiles[i].sacredId = site.id;
    }
  }

  // landing site: best coastal ground
  let best = { x: st.W / 2, y: st.H / 2, score: -1 };
  for (let y = 4; y < st.H - 4; y++) for (let x = 4; x < st.W - 4; x++) {
    const sc = scoreSite(st, x, y);
    if (sc > best.score) best = { x, y, score: sc };
  }
  const first = blankSettlement(st, best.x, best.y, placeName(st.rng, st.culture) || 'First Landing', 'the Firstcomers');
  first.food = 110;

  // twenty souls step ashore
  const settlers: Person[] = [];
  for (let i = 0; i < 20; i++) {
    const sex = i % 2 === 0 ? 'm' : 'f';
    const age = i < 14 ? ri(st.rng, 17, 38) : ri(st.rng, 3, 12);
    settlers.push(newPerson(st, sex, age, first.id));
  }
  // some arrive already bound to one another
  const adults = settlers.filter(p => p.age >= 16);
  const men = adults.filter(p => p.sex === 'm');
  const women = adults.filter(p => p.sex === 'f');
  for (let i = 0; i < Math.min(men.length, women.length, 5); i++) {
    men[i].spouse = women[i].id;
    women[i].spouse = men[i].id;
  }
  refreshPop(st);

  st.eras.push({ name: 'The Arrival', startYear: 1, note: 'Twenty souls, one boat, an empty island.' });
  addEvent(st, 'arrival', 3,
    `Twenty souls step ashore at ${first.name}, salt-stained and hungry, carrying seed-grain, three axes, and the names of their dead. The island of ${st.worldName} does not yet know they are here.`,
    first.id);
  return st;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

export function refreshPop(st: SimState): void {
  const counts = new Map<number, number>();
  for (const p of st.people) counts.set(p.home, (counts.get(p.home) ?? 0) + 1);
  for (const s of st.settlements) s.pop = counts.get(s.id) ?? 0;
}

export function living(st: SimState): Settlement[] {
  return st.settlements.filter(s => !s.razed);
}

export function fertAround(st: SimState, s: Settlement): number {
  let total = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!inBounds(st, s.x + dx, s.y + dy)) continue;
    const t = st.tiles[idx(st, s.x + dx, s.y + dy)];
    if (t.t !== 'ocean' && t.t !== 'mountain') { total += t.fert; n++; }
  }
  return n ? total / n : 0.3;
}

function nearRiver(st: SimState, s: Settlement): boolean {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (inBounds(st, s.x + dx, s.y + dy) && st.tiles[idx(st, s.x + dx, s.y + dy)].river) return true;
  }
  return false;
}

function isCoastal(st: SimState, s: Settlement): boolean {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (inBounds(st, s.x + dx, s.y + dy) && st.tiles[idx(st, s.x + dx, s.y + dy)].t === 'ocean') return true;
  }
  return false;
}

function forestAround(st: SimState, s: Settlement): number {
  let total = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (inBounds(st, s.x + dx, s.y + dy)) total += st.tiles[idx(st, s.x + dx, s.y + dy)].forest;
  }
  return total;
}

export function capacityOf(st: SimState, s: Settlement): number {
  let cap = 24 + fertAround(st, s) * 34 + (s.buildings.granary ?? 0) * 10;
  if (hasTech(st, 'irrigation') && nearRiver(st, s)) cap += 12;
  if (hasTech(st, 'sailing') && isCoastal(st, s)) cap += 10;
  cap -= s.taboos.length * 4; // taboos set land and labor aside
  return cap;
}

function adultsOf(st: SimState, s: Settlement): Person[] {
  return st.people.filter(p => p.home === s.id && p.age >= 14 && p.age < 68);
}

function killPerson(st: SimState, p: Person, cause: 'age' | 'famine' | 'plague' | 'war' | 'mishap'): void {
  const i = st.people.indexOf(p);
  if (i >= 0) st.people.splice(i, 1);
  st.stats.died++;
  if (cause === 'famine') st.stats.famineDeaths++;
  if (cause === 'plague') st.stats.plagueDeaths++;
  if (cause === 'war') st.stats.warDeaths++;
  if (p.spouse !== null) {
    const sp = st.people.find(q => q.id === p.spouse);
    if (sp) { sp.spouse = null; sp.morale = Math.max(0, sp.morale - 12); addMemory(sp, `Widowed in year ${yearOf(st.tick)}`); }
  }
  const s = st.settlements.find(x => x.id === p.home);
  if (s && s.leader === p.id) {
    s.leader = null;
    if (p.renown > 14) {
      addEvent(st, 'death', 2, `${p.name}, who led ${s.name} for years, has died. The settlement argues over who now speaks for it.`, s.id);
      s.cohesion = Math.max(0, s.cohesion - 8);
    }
  }
}

// ---------------------------------------------------------------------
// Seasonal economy
// ---------------------------------------------------------------------

const SEASON_YIELD = [1.15, 1.3, 1.55, 0.15];

function economy(st: SimState): void {
  const season = seasonOf(st.tick);
  for (const s of living(st)) {
    const adults = adultsOf(st, s);
    const nAdults = adults.length;
    const fert = fertAround(st, s);

    let techF = 1;
    if (hasTech(st, 'irrigation') && nearRiver(st, s)) techF += 0.18;
    if (hasTech(st, 'calendar')) techF += 0.07;
    let weatherF = 1 + st.weather.rain * 0.13 - st.weather.drought * 0.42;
    weatherF = Math.max(0.15, weatherF);
    const blessF = (s.blessed > 0 ? 1.65 : 1) * (s.cursed > 0 ? 0.78 : 1);
    const moraleF = 0.75 + s.morale / 200;

    let food = nAdults * 2.25 * fert * SEASON_YIELD[season] * techF * weatherF * blessF * moraleF;
    if (isCoastal(st, s)) food += nAdults * (hasTech(st, 'sailing') ? 0.55 : 0.3) * (season === 3 ? 0.5 : 1);
    s.food += food;

    s.wood += Math.min(nAdults * 0.35, forestAround(st, s) * 0.5) * (s.taboos.length ? 0.85 : 1);
    const hilly = st.tiles[idx(st, s.x, s.y)].t === 'hills' || st.tiles[idx(st, s.x, s.y)].elev > 0.5;
    s.stone += nAdults * (hilly ? 0.22 : 0.08) * (hasTech(st, 'masonry') ? 1.5 : 1);

    let know = nAdults * 0.028 * (hasTech(st, 'writing') ? 1.6 : 1);
    if (s.inspired > 0) know *= 1.9;
    know *= 1 + (s.buildings.hall ?? 0) * 0.1;
    s.knowledge += know;

    // eat
    s.food -= s.pop * 1.0;
    if (s.food < 0) {
      s.food = 0;
      s.hunger++;
      s.morale = Math.max(0, s.morale - 4.5);
      if (s.hunger === 2) addEvent(st, 'famine', 2, `Hunger settles over ${s.name}. The stores are empty and the children are quiet.`, s.id);
      if (s.hunger >= 2) {
        const folk = st.people.filter(p => p.home === s.id);
        for (const p of folk) {
          const frail = p.age < 6 || p.age > 60 ? 2 : 1;
          if (chance(st.rng, 0.006 * s.hunger * frail)) killPerson(st, p, 'famine');
        }
      }
    } else {
      if (s.hunger >= 3) addEvent(st, 'famine', 2, `The famine in ${s.name} breaks at last. ${s.pop} remain to bury the rest.`, s.id);
      s.hunger = 0;
    }
    const capFood = 90 + (s.buildings.granary ?? 0) * 90 + (hasTech(st, 'pottery') ? 60 : 0);
    s.food = Math.min(s.food, capFood);

    // wellness drift
    let targetHealth = 56 + (s.buildings.well ?? 0) * 8 + (hasTech(st, 'medicine') ? 10 : 0) - Math.max(0, s.pop - capacityOf(st, s)) * 0.4;
    if (s.plague > 0) targetHealth -= 25;
    s.health += (Math.max(10, Math.min(95, targetHealth)) - s.health) * 0.1;

    // morale drift toward conditions
    let targetMorale = 52 + (s.food > s.pop * 2 ? 8 : 0) + (hasTech(st, 'music') ? 4 : 0) + (s.buildings.monument ?? 0) * 4
      + s.faith * 0.08 - (s.warWith !== null ? 12 : 0) - (s.plague > 0 ? 15 : 0) - (s.cursed > 0 ? 10 : 0);
    s.morale += (Math.max(5, Math.min(95, targetMorale)) - s.morale) * 0.06;

    // faith drifts toward its supports
    const targetFaith = 12 + (s.buildings.shrine ?? 0) * 9 + (s.buildings.temple ?? 0) * 16
      + Math.min(20, (s.graceSeen + s.wrathSeen) * 1.5) + (s.patron !== null ? 8 : 0);
    s.faith += (Math.max(0, Math.min(100, targetFaith)) - s.faith) * 0.045;

    // cohesion strains with size, mends with halls and shared belief
    const targetCoh = 62 - Math.max(0, s.pop - 40) * 0.35 + (s.buildings.hall ?? 0) * 7 + s.faith * 0.1 + s.taboos.length * 3
      + (s.inspired > 0 ? 10 : 0);
    s.cohesion += (Math.max(5, Math.min(95, targetCoh)) - s.cohesion) * 0.05;

    // timers
    if (s.blessed > 0) s.blessed--;
    if (s.cursed > 0) {
      s.cursed--;
      if (chance(st.rng, 0.1)) {
        const folk = st.people.filter(p => p.home === s.id);
        if (folk.length) {
          const victim = pick(st.rng, folk);
          victim.health -= 25;
          if (victim.health <= 0) { killPerson(st, victim, 'mishap'); addEvent(st, 'mishap', 1, `Another grim accident in ${s.name}: ${victim.name} is dead. People mutter that the place is marked.`, s.id); }
        }
      }
    }
    if (s.inspired > 0) s.inspired--;
    if (s.boom > 0) s.boom--;
  }
}

// ---------------------------------------------------------------------
// Plague
// ---------------------------------------------------------------------

function plagues(st: SimState): void {
  for (const s of living(st)) {
    if (s.plague > 0) {
      s.plague--;
      const resist = hasTech(st, 'medicine') ? 0.45 : 1;
      const folk = st.people.filter(p => p.home === s.id);
      for (const p of folk) {
        if (chance(st.rng, 0.022 * resist * (p.age > 55 || p.age < 8 ? 1.6 : 1))) killPerson(st, p, 'plague');
      }
      // contagion travels the trade roads
      for (const o of living(st)) {
        if (o.id === s.id || o.plague > 0) continue;
        if ((s.relations[o.id] ?? 0) > 10 && dist(s.x, s.y, o.x, o.y) < 20 && chance(st.rng, 0.03)) {
          o.plague = ri(st.rng, 5, 9);
          addEvent(st, 'plague', 2, `The sickness has followed the traders to ${o.name}.`, o.id);
        }
      }
      if (s.plague === 0) {
        addEvent(st, 'plague', 2, `The pestilence in ${s.name} burns out. Survivors mark their doors and plant twice as much.`, s.id);
        notifyCondition(st, 'plague_end');
        if (!hasTech(st, 'medicine')) s.knowledge += 18; // grim lessons
      }
    } else if (s.pop > 55 && s.health < 45 && chance(st.rng, 0.004)) {
      s.plague = ri(st.rng, 6, 11);
      addEvent(st, 'plague', 3, `A sickness rises in the crowded lanes of ${s.name}. First the old, then the young; the healers are helpless.`, s.id);
      recordSignal(st, 'death', 0, 0.6, s.id); // even natural death asks for a theology
    }
  }
}

// ---------------------------------------------------------------------
// People: birth, death, marriage, leadership
// ---------------------------------------------------------------------

function peopleTick(st: SimState): void {
  const season = seasonOf(st.tick);
  const dead: Person[] = [];
  for (const p of st.people) {
    p.age += 1 / TICKS_PER_YEAR;
    const s = st.settlements.find(x => x.id === p.home);
    if (!s) continue;
    p.health += (s.health - p.health) * 0.06;
    p.morale += (s.morale - p.morale) * 0.08;
    p.faith += (s.faith - p.faith) * 0.05;
    let mort = 0.0006;
    if (p.age > 52) mort += (p.age - 52) * 0.00095;
    mort += Math.max(0, (45 - p.health)) * 0.00012;
    if (chance(st.rng, mort)) dead.push(p);
  }
  for (const p of dead) {
    const s = st.settlements.find(x => x.id === p.home);
    killPerson(st, p, 'age');
    if (p.renown > 20 && s) {
      addEvent(st, 'death', 2, `${p.name} of ${s.name} has died, full of years. ${p.memories.length ? 'It is remembered that they ' + p.memories[p.memories.length - 1].toLowerCase() + '.' : 'The whole settlement walks behind the bier.'}`, s.id);
    }
  }

  // births favor the warm halves of the year
  for (const s of living(st)) {
    if (s.hunger >= 3) continue;
    const cap = capacityOf(st, s);
    const room = Math.max(0, 1.35 - s.pop / Math.max(1, cap));
    const women = st.people.filter(p => p.home === s.id && p.sex === 'f' && p.age >= 17 && p.age <= 42 && p.spouse !== null);
    const crowd = Math.max(0.2, Math.min(1, 1.75 - st.people.length / 340)); // the island itself has limits
    for (const w of women) {
      let pBirth = 0.062 * room * crowd * (0.7 + s.morale / 150) * (season <= 1 ? 1.2 : 0.9);
      if (s.boom > 0) pBirth *= 1.5;
      if (chance(st.rng, pBirth)) {
        const baby = newPerson(st, chance(st.rng, 0.5) ? 'm' : 'f', 0, s.id);
        baby.prof = 'child';
        st.stats.born++;
      }
    }
  }

  if (season === 1) { // midsummer matches are made
    for (const s of living(st)) {
      const single = st.people.filter(p => p.home === s.id && p.spouse === null && p.age >= 17 && p.age <= 48);
      const men = shuffled(st.rng, single.filter(p => p.sex === 'm'));
      const women = shuffled(st.rng, single.filter(p => p.sex === 'f'));
      const n = Math.min(men.length, women.length);
      for (let i = 0; i < n; i++) {
        if (chance(st.rng, 0.4)) {
          men[i].spouse = women[i].id;
          women[i].spouse = men[i].id;
        }
      }
    }
  }

  if (season === 3) { // winter councils settle leadership and work
    for (const s of living(st)) {
      const adults = adultsOf(st, s);
      if (!adults.length) continue;
      if (s.leader === null || !st.people.some(p => p.id === s.leader)) {
        const cand = adults.slice().sort((a, b) => (b.renown + b.age * 0.3) - (a.renown + a.age * 0.3))[0];
        if (cand && cand.age > 22) {
          s.leader = cand.id;
          cand.renown += 6;
          if (cand.renown > 12) addEvent(st, 'leader', 1, `${cand.name} now speaks for ${s.name} at the winter council.`, s.id);
        }
      } else {
        const l = st.people.find(p => p.id === s.leader);
        if (l) l.renown += 1.5;
      }
      // rough profession rebalance (mostly flavor, small effects via counts)
      for (const p of adults) {
        if (p.prof === 'child') p.prof = pick(st.rng, PROFS);
        if (s.faith > 50 && chance(st.rng, 0.03)) p.prof = 'priest';
      }
    }
  }
}

// ---------------------------------------------------------------------
// Building and invention (spring / winter)
// ---------------------------------------------------------------------

const BUILDS: { id: string; wood: number; stone: number; req?: string; max: number; want: (st: SimState, s: Settlement) => boolean; text: string }[] = [
  { id: 'granary', wood: 35, stone: 0, max: 3, want: (st, s) => s.pop > 20 + (s.buildings.granary ?? 0) * 18, text: 'raises a granary against the lean seasons' },
  { id: 'well', wood: 10, stone: 25, max: 2, want: (st, s) => s.health < 55 && s.pop > 15, text: 'digs a stone-lined well' },
  { id: 'shrine', wood: 20, stone: 5, max: 2, want: (st, s) => s.faith > 28 && (s.buildings.shrine ?? 0) < 1 + (s.patron !== null ? 1 : 0), text: 'builds a shrine of driftwood and offerings' },
  { id: 'hall', wood: 45, stone: 10, max: 2, want: (st, s) => s.pop > 30 && s.cohesion < 60, text: 'raises a great hall for councils and weddings' },
  { id: 'walls', wood: 20, stone: 70, req: 'masonry', max: 2, want: (st, s) => st.stats.wars > 0 && s.pop > 25, text: 'rings itself in stone walls' },
  { id: 'temple', wood: 40, stone: 60, req: 'masonry', max: 2, want: (st, s) => s.faith > 55 && s.patron !== null, text: 'begins a temple, the largest thing ever built here' },
  { id: 'monument', wood: 10, stone: 90, req: 'masonry', max: 1, want: (st, s) => s.pop > 45 && s.morale > 60, text: 'carves a monument so the future will know their names' },
];

function construction(st: SimState): void {
  if (seasonOf(st.tick) !== 0) return;
  for (const s of living(st)) {
    for (const b of BUILDS) {
      if (b.req && !hasTech(st, b.req)) continue;
      if ((s.buildings[b.id] ?? 0) >= b.max) continue;
      if (s.wood < b.wood || s.stone < b.stone) continue;
      if (!b.want(st, s)) continue;
      s.wood -= b.wood;
      s.stone -= b.stone;
      s.buildings[b.id] = (s.buildings[b.id] ?? 0) + 1;
      const isTemple = b.id === 'temple';
      addEvent(st, 'building', isTemple ? 3 : 1, `${s.name} ${b.text}.`, s.id);
      if (isTemple) {
        const d = st.deities.find(x => x.id === s.patron);
        if (d) addEvent(st, 'faith', 2, `The temple of ${d.name} in ${s.name} is consecrated with three days of feasting.`, s.id);
        if (!st.eras.some(e => e.name === 'The Age of Temples')) pushEra(st, 'The Age of Temples', 'Faith is now built in stone.');
      }
      break; // one project a year
    }
  }
}

function invention(st: SimState): void {
  if (seasonOf(st.tick) !== 3) return;
  // each art is harder to reach than the last: the easy ideas get had first
  const costMult = 1 + Object.keys(st.techs).length * 0.35;
  for (const s of living(st)) {
    for (const t of TECHS) {
      if (hasTech(st, t.id)) continue;
      if (t.req && !hasTech(st, t.req)) continue;
      if (s.knowledge < t.cost * costMult) continue;
      const p = 0.22 + (s.inspired > 0 ? 0.4 : 0);
      if (!chance(st.rng, p)) continue;
      s.knowledge -= t.cost * costMult * 0.6;
      st.techs[t.id] = yearOf(st.tick);
      const inventor = st.people.filter(x => x.home === s.id && x.age > 18);
      const who = inventor.length ? pick(st.rng, inventor) : null;
      if (who) { who.renown += 10; addMemory(who, `First worked ${t.name} in year ${yearOf(st.tick)}`); }
      addEvent(st, 'tech', 3, `${s.name} has mastered ${t.name}${who ? ' — they credit ' + who.name : ''}. ${t.desc}`, s.id);
      if (t.id === 'ironwork') pushEra(st, 'The Age of Iron', 'Grey metal changes what a quarrel can cost.');
      if (t.id === 'writing') addEvent(st, 'tech', 2, `The first chronicle of ${st.worldName} is scratched onto clay. History now has a second author.`, s.id);
      break;
    }
  }
}

// ---------------------------------------------------------------------
// Migration, expeditions, schisms (summer)
// ---------------------------------------------------------------------

export function foundSettlement(st: SimState, x: number, y: number, migrants: Person[], faction: string, why: string, fromName: string): Settlement {
  const s = blankSettlement(st, x, y, placeName(st.rng, st.culture), faction);
  for (const p of migrants) {
    p.home = s.id;
    addMemory(p, `Left ${fromName} to found ${s.name}`);
  }
  refreshPop(st);
  // migrants carry their gods with them
  const origin = st.settlements.find(o => o.name === fromName);
  if (origin) {
    s.patron = origin.patron;
    s.sect = origin.sect;
    s.relations[origin.id] = faction === origin.faction ? 35 : -25;
    origin.relations[s.id] = faction === origin.faction ? 35 : -25;
    s.food = Math.min(60, origin.food * 0.25);
    origin.food *= 0.75;
  }
  addEvent(st, 'founding', 3, `${why} They raise the first roofs of ${s.name}.`, s.id);
  if (st.settlements.filter(z => !z.razed).length === 2) {
    pushEra(st, 'The Age of Hearths', 'One settlement becomes two; the island begins to fill.');
  }
  return s;
}

function migrationAndSchism(st: SimState): void {
  if (seasonOf(st.tick) !== 1) return;
  for (const s of living(st)) {
    if (st.tick - s.lastSplit < 56) continue;
    const cap = capacityOf(st, s);
    const crowded = s.pop > cap * 1.05 && s.pop >= 34;
    const fractious = s.cohesion < 26 && s.pop >= 26;
    const droughtFlight = st.weather.drought > 1.2 && s.hunger >= 2 && s.pop >= 24;
    if (!crowded && !fractious && !droughtFlight) continue;
    if (!chance(st.rng, fractious ? 0.45 : 0.28)) continue;

    // prefer land near sacred ground; avoid old ruins
    const site = findSettlementSite(st, s.x, s.y, 6, 16) ?? findSettlementSite(st, s.x, s.y, 4, 24);
    if (!site) continue;
    const folk = shuffled(st.rng, st.people.filter(p => p.home === s.id));
    const nLeave = Math.floor(s.pop * (fractious ? 0.45 : 0.34));
    const migrants = folk.slice(0, nLeave);
    if (migrants.length < 8) continue;
    s.lastSplit = st.tick;
    if (fractious) {
      const faction = `the ${pick(st.rng, ['Ash', 'Reed', 'Salt', 'Elk', 'Crow', 'Ember'])}-kin`;
      const ns = foundSettlement(st, site.x, site.y, migrants, faction,
        `After a winter of knives-under-smiles, nearly half of ${s.name} walks out at dawn, calling themselves ${faction}.`, s.name);
      ns.cohesion = 75;
      s.cohesion = Math.min(100, s.cohesion + 20);
      s.tension[ns.id] = 15;
    } else {
      foundSettlement(st, site.x, site.y, migrants, s.faction,
        crowded
          ? `${s.name} has grown past what its fields can feed, and the young families draw lots for who must go.`
          : `Driven by the long drought, families from ${s.name} follow the birds toward greener ground.`,
        s.name);
    }
    refreshPop(st);
  }
}

// ---------------------------------------------------------------------
// Trade, tension, and war
// ---------------------------------------------------------------------

function trade(st: SimState): void {
  if (seasonOf(st.tick) !== 2) return; // autumn caravans
  const ls = living(st);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const a = ls[i], b = ls[j];
    const d = dist(a.x, a.y, b.x, b.y);
    const seaRoute = hasTech(st, 'sailing') && isCoastal(st, a) && isCoastal(st, b);
    if (d > 20 && !seaRoute) continue;
    if ((a.relations[b.id] ?? 0) < 0) continue;
    if (a.warWith === b.id) continue;
    // complementary surpluses change hands
    const rich = a.food > b.food * 1.6 ? a : b.food > a.food * 1.6 ? b : null;
    if (rich) {
      const poor = rich === a ? b : a;
      const amount = Math.min(rich.food * 0.12, 25);
      rich.food -= amount;
      poor.food += amount;
      poor.wood += 0; // gratitude is its own currency early on
      a.relations[b.id] = Math.min(100, (a.relations[b.id] ?? 0) + 4);
      b.relations[a.id] = Math.min(100, (b.relations[a.id] ?? 0) + 4);
      a.morale = Math.min(100, a.morale + 1.5);
      b.morale = Math.min(100, b.morale + 1.5);
      if (chance(st.rng, 0.12)) addEvent(st, 'trade', 1, `Caravans pass between ${a.name} and ${b.name}; grain one way, timber and stories the other.`, null);
    } else if (chance(st.rng, 0.3)) {
      a.relations[b.id] = Math.min(100, (a.relations[b.id] ?? 0) + 2);
      b.relations[a.id] = Math.min(100, (b.relations[a.id] ?? 0) + 2);
    }
  }
}

function tensionsAndWar(st: SimState): void {
  const ls = living(st);
  if (seasonOf(st.tick) === 3) {
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d > 22) continue;
      let dT = -0.9; // grievances cool by default, slowly
      if (d < 10) dT += 2.2;
      if (a.hunger >= 2 || b.hunger >= 2) dT += 3.2;
      if (a.patron !== b.patron && a.patron !== null && b.patron !== null) dT += 1.8;
      if (a.sect !== b.sect && a.sect !== null && b.sect !== null) dT += 2.6;
      if (a.inspired > 0 || b.inspired > 0) dT += 2.0; // ambition is a fire
      if (a.faction !== b.faction) dT += 1.5;
      if (d < 14) dT += Math.max(0, ls.length - 4) * 0.3; // a filling island runs out of elsewhere
      const t = Math.max(0, Math.min(100, (a.tension[b.id] ?? 0) + dT));
      a.tension[b.id] = t;
      b.tension[a.id] = t;
      a.relations[b.id] = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) - t * 0.09));
      b.relations[a.id] = a.relations[b.id];

      const truceHolds = (a.truce[b.id] ?? 0) > st.tick;
      if (t > 44 && (a.relations[b.id] ?? 0) < -5 && !truceHolds && a.warWith === null && b.warWith === null && chance(st.rng, 0.35)) {
        a.warWith = b.id;
        b.warWith = a.id;
        a.warStart = st.tick;
        b.warStart = st.tick;
        st.stats.wars++;
        const holy = a.sect !== b.sect && a.sect !== null && b.sect !== null;
        addEvent(st, 'war', 3, holy
          ? `Doctrine becomes bloodshed: ${a.name} marches on ${b.name}, each calling the other blasphemers of the same god.`
          : `Raids and reprisals harden into open war between ${a.name} and ${b.name}.`, a.id);
        if (!st.eras.some(e => e.name === 'The Age of Strife')) pushEra(st, 'The Age of Strife', 'The island learns what an enemy is.');
      }
    }
  }

  // wars grind on every season
  for (const a of ls) {
    if (a.warWith === null) continue;
    const b = st.settlements.find(x => x.id === a.warWith);
    if (!b || b.razed) { a.warWith = null; continue; }
    if (a.id > b.id) continue; // process each pair once

    const wF = 1 + (hasTech(st, 'bronzework') ? 0.3 : 0) + (hasTech(st, 'ironwork') ? 0.6 : 0);
    const strA = a.pop * (0.6 + a.morale / 150) * wF * (1 + (a.buildings.walls ?? 0) * 0.12);
    const strB = b.pop * (0.6 + b.morale / 150) * wF * (1 + (b.buildings.walls ?? 0) * 0.12);
    for (const [side, foeStr] of [[a, strB], [b, strA]] as [Settlement, number][]) {
      const folk = st.people.filter(p => p.home === side.id && p.age > 15 && p.age < 55);
      const losses = Math.min(folk.length, Math.round(foeStr * 0.006 * (0.6 + rnd(st.rng) * 0.8)));
      for (let k = 0; k < losses; k++) {
        const v = folk[Math.floor(rnd(st.rng) * folk.length)];
        if (v) killPerson(st, v, 'war');
      }
      side.morale = Math.max(0, side.morale - 2.5);
      side.food -= losses * 1.5;
    }
    refreshPop(st);

    const dur = st.tick - a.warStart;
    const exhausted = a.morale < 25 || b.morale < 25 || a.pop < 14 || b.pop < 14 || dur > 14;
    if (exhausted) {
      const winner = strA >= strB ? a : b;
      const loser = winner === a ? b : a;
      a.warWith = null;
      b.warWith = null;
      a.truce[b.id] = st.tick + 50;
      b.truce[a.id] = st.tick + 50;
      a.tension[b.id] = 8;
      b.tension[a.id] = 8;

      const ratio = Math.max(strA, strB) / Math.max(1, Math.min(strA, strB));
      if (ratio > 1.5 && loser.pop < 22 && chance(st.rng, 0.55)) {
        razeSettlement(st, loser, winner);
      } else if (ratio > 1.25) {
        const tribute = loser.food * 0.35;
        loser.food -= tribute;
        winner.food += tribute;
        winner.stone += loser.stone * 0.25;
        loser.stone *= 0.75;
        addEvent(st, 'war', 3, `The war ends: ${loser.name} sues for peace and sends tribute carts to ${winner.name}. The dead on both sides are sung home.`, winner.id);
        const wl = st.people.find(p => p.id === winner.leader);
        if (wl) { wl.renown += 15; makeLegend(st, `The Victory of ${wl.name}`, `They still sing how ${wl.name} of ${winner.name} broke the lines of ${loser.name} and then — this is the part the singers lean on — let the survivors walk home unharmed.`); }
      } else {
        addEvent(st, 'war', 2, `The war between ${a.name} and ${b.name} gutters out. No victor, only widows, and a truce sworn on salt.`, null);
      }
    }
  }
}

export function razeSettlement(st: SimState, loser: Settlement, winner: Settlement | null): void {
  loser.razed = true;
  loser.razedYear = yearOf(st.tick);
  const t = st.tiles[idx(st, loser.x, loser.y)];
  t.ruinName = loser.name;
  st.terrainV++;
  const folk = st.people.filter(p => p.home === loser.id);
  let killed = 0;
  for (const p of folk) {
    if (chance(st.rng, 0.4)) { killPerson(st, p, 'war'); killed++; }
    else {
      const refuge = winner ?? living(st).filter(s2 => s2.id !== loser.id)[0];
      if (refuge) {
        p.home = refuge.id;
        addMemory(p, `Fled the burning of ${loser.name}`);
        p.morale = Math.max(0, p.morale - 20);
      } else {
        killPerson(st, p, 'war');
        killed++;
      }
    }
  }
  refreshPop(st);
  addEvent(st, 'ruin', 3, winner
    ? `${loser.name} burns. ${killed} die in the sack; the survivors are marched to ${winner.name} with what they can carry. Only fire-blackened stones remain.`
    : `${loser.name} is abandoned to the wind. Its empty doorways watch the road.`,
    winner ? winner.id : null);
}

// ---------------------------------------------------------------------
// Natural events
// ---------------------------------------------------------------------

function naturalEvents(st: SimState): void {
  const season = seasonOf(st.tick);
  // storms off the sea
  if ((season === 2 || season === 3) && chance(st.rng, 0.02)) {
    const coastal = living(st).filter(s => isCoastal(st, s));
    if (coastal.length) {
      const s = pick(st.rng, coastal);
      s.food *= 0.85;
      s.wood += 8; // wrecks and driftwood
      s.morale = Math.max(0, s.morale - 5);
      addEvent(st, 'disaster', 1, pick(st.rng, [
        `A black storm hammers ${s.name}; boats are lost, roofs peeled back like bark.`,
        `The sea stands up against ${s.name} for a night and a day. They spend a week pulling nets out of trees.`,
        `Lightning walks the shore at ${s.name}. An old drying-shed burns; the rain, at least, is fresh water.`,
        `A gale drives the fishing fleet of ${s.name} home early, minus one hull. The widow watches the horizon all winter.`,
      ]), s.id);
      recordSignal(st, 'storm', 0, 0.3, s.id);
    }
  }
  // wildfire in dry summers
  if (season === 1 && st.weather.drought > 0.8 && chance(st.rng, 0.05)) {
    const s = pick(st.rng, living(st));
    s.food *= 0.8;
    s.morale = Math.max(0, s.morale - 6);
    addEvent(st, 'disaster', 2, `Wildfire runs the dry hills near ${s.name}. The sky is orange for three days.`, s.id);
  }
  // the ground remembers it is alive
  if (chance(st.rng, 0.0025)) {
    const s = pick(st.rng, living(st));
    for (const b of Object.keys(s.buildings)) {
      if (chance(st.rng, 0.3)) s.buildings[b] = Math.max(0, s.buildings[b] - 1);
    }
    s.morale = Math.max(0, s.morale - 10);
    addEvent(st, 'disaster', 2, `The earth shakes beneath ${s.name}. Walls crack; the old say the island turned in its sleep.`, s.id);
    recordSignal(st, 'earth', 0, 0.8, s.id);
  }
}

// ---------------------------------------------------------------------
// Delayed ripples (mostly seeded by interventions)
// ---------------------------------------------------------------------

function processDelayed(st: SimState): void {
  const due = st.delayed.filter(d => d.tick <= st.tick);
  if (!due.length) return;
  st.delayed = st.delayed.filter(d => d.tick > st.tick);
  for (const d of due) {
    const s = d.a !== undefined ? st.settlements.find(x => x.id === d.a && !x.razed) : undefined;
    switch (d.kind) {
      case 'flood': {
        const riverside = living(st).filter(x => nearRiver(st, x));
        for (const rs of riverside) {
          rs.food *= 0.68;
          const folk = st.people.filter(p => p.home === rs.id);
          for (const p of folk) if (chance(st.rng, 0.012)) killPerson(st, p, 'mishap');
          // silt makes next years richer
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (!inBounds(st, rs.x + dx, rs.y + dy)) continue;
            const t = st.tiles[idx(st, rs.x + dx, rs.y + dy)];
            if (t.river) t.fert = Math.min(1.4, t.fert + 0.06);
          }
        }
        if (riverside.length) {
          addEvent(st, 'disaster', 3, `Too much rain, too fast: the rivers leave their beds. Fields drown along every bank — though the elders note, grimly, that flooded ground grows back richer.`, null);
          recordSignal(st, 'storm', 0.3, 1.2, null);
        }
        break;
      }
      case 'reflection': {
        if (s) {
          recordSignal(st, 'death', 0, 1, s.id);
          s.knowledge += 30;
          addEvent(st, 'faith', 2, `In the quiet after the plague, ${s.name} rebuilds strangely: wider lanes, water carried from upstream, and a new solemnity at the shrines.`, s.id);
          maybeTaboo(st, s, 'death');
        }
        break;
      }
      case 'scapegoat': {
        if (s) {
          if (chance(st.rng, 0.5)) {
            s.cohesion = Math.max(0, s.cohesion - 10);
            addEvent(st, 'strife', 2, `${s.name} turns on itself hunting the cause of its misfortunes. Accusations, a burned house, a family driven out.`, s.id);
          } else {
            maybeTaboo(st, s, 'earth');
          }
        }
        break;
      }
      case 'visionFades': {
        if (s && s.leader !== null) {
          const l = st.people.find(p => p.id === s.leader);
          if (l && l.renown > 18) {
            makeLegend(st, `The Dreams of ${l.name}`, `For years ${l.name} of ${s.name} woke before dawn with plans no one had taught them — canals, arguments, alphabets. Then the dreams stopped, as suddenly as they came, and ${l.name} wept at the door like someone widowed.`);
          }
        }
        break;
      }
      case 'droughtBites': {
        for (const x of living(st)) {
          if (!nearRiver(st, x)) {
            for (const y2 of living(st)) {
              if (y2.id !== x.id && nearRiver(st, y2) && dist(x.x, x.y, y2.x, y2.y) < 18) {
                x.tension[y2.id] = Math.min(100, (x.tension[y2.id] ?? 0) + 10);
                y2.tension[x.id] = x.tension[y2.id];
              }
            }
          }
        }
        addEvent(st, 'strife', 2, `The drought sorts the island into those who hold rivers and those who do not. Watchfires appear along the water.`, null);
        break;
      }
      case 'pilgrimSite': {
        if (s && !st.tiles[idx(st, s.x, s.y)].sacredId) {
          const site: SacredSite = {
            id: st.nextId++, x: s.x, y: s.y,
            name: `the Healing Ground of ${s.name}`,
            year: yearOf(st.tick), deityId: s.patron, kind: 'miracle',
          };
          st.sacred.push(site);
          st.tiles[idx(st, s.x, s.y)].sacredId = site.id;
          st.terrainV++;
          addEvent(st, 'faith', 2, `Pilgrims now walk to ${s.name} from across the island, to touch the ground where the dying stood up.`, s.id);
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------
// Influence & eras & sampling
// ---------------------------------------------------------------------

function influenceRegen(st: SimState): void {
  const temples = living(st).reduce((n, s) => n + (s.buildings.temple ?? 0), 0);
  const shrines = living(st).reduce((n, s) => n + (s.buildings.shrine ?? 0), 0);
  const worship = st.deities.reduce((n, d) => n + d.worship, 0);
  const regen = Math.min(2.2, 0.45 + temples * 0.22 + shrines * 0.07 + worship / 4000);
  st.influence = Math.min(st.influenceMax, st.influence + regen);
}

function eraChecks(st: SimState): void {
  if (seasonOf(st.tick) !== 3) return;
  const pop = st.people.length;
  if (pop > st.stats.peakPop) st.stats.peakPop = pop;
  const hasAsh = st.eras.some(e => e.name === 'The Age of Ash');
  if (!hasAsh && st.stats.peakPop > 80 && pop < st.stats.peakPop * 0.6) {
    pushEra(st, 'The Age of Ash', 'The island holds more graves than cradles.');
  }
  if (hasAsh && !st.eras.some(e => e.name === 'The Rekindling') && pop > st.stats.peakPop * 0.85) {
    pushEra(st, 'The Rekindling', 'Against every expectation, the hearths fill again.');
  }
  const lastWar = st.events.filter(e => e.type === 'war').pop();
  if (yearOf(st.tick) > 120 && pop > 110 && st.stats.wars > 0 && lastWar && st.tick - lastWar.tick > 100
    && !st.eras.some(e => e.name === 'The Long Peace')) {
    pushEra(st, 'The Long Peace', 'A generation grows up unable to describe a war.');
  }
}

function sampleHistory(st: SimState): void {
  if (seasonOf(st.tick) !== 3) return;
  st.history.push({
    year: yearOf(st.tick),
    pop: st.people.length,
    food: Math.round(living(st).reduce((n, s) => n + s.food, 0)),
    faith: Math.round(living(st).reduce((n, s) => n + s.faith * s.pop, 0) / Math.max(1, st.people.length)),
    knowledge: Math.round(living(st).reduce((n, s) => n + s.knowledge, 0) + Object.keys(st.techs).length * 100),
    settlements: living(st).length,
    warDeaths: st.stats.warDeaths,
  });
}

// ---------------------------------------------------------------------
// Master tick
// ---------------------------------------------------------------------

export function simTick(st: SimState): void {
  if (st.ended) return;
  st.tick++;

  // weather decays toward calm
  st.weather.rain = Math.max(0, st.weather.rain - 0.12);
  st.weather.drought = Math.max(0, st.weather.drought - 0.07);
  if (st.weather.eclipse > 0) st.weather.eclipse--;
  if (st.weather.comet > 0) st.weather.comet--;
  if (st.weather.rain > 0.5) notifyCondition(st, 'rain');

  economy(st);
  plagues(st);
  peopleTick(st);
  refreshPop(st);
  construction(st);
  invention(st);
  migrationAndSchism(st);
  trade(st);
  tensionsAndWar(st);
  naturalEvents(st);
  religionTick(st);
  processDelayed(st);
  influenceRegen(st);
  eraChecks(st);
  sampleHistory(st);

  // settlements can die quietly, too
  for (const s of living(st)) {
    if (s.pop === 0) {
      razeSettlement(st, s, null);
    }
  }

  if (st.people.length === 0) {
    st.ended = true;
    st.endText = 'extinction';
    addEvent(st, 'era', 3, `The last voice on ${st.worldName} falls silent in year ${yearOf(st.tick)}. The island belongs to the birds again.`);
    return;
  }
  if (yearOf(st.tick) > END_YEAR) {
    st.ended = true;
    st.endText = 'end';
    addEvent(st, 'era', 3, `Two hundred years inside the glass. The chronicle closes — though for the people of ${st.worldName}, tomorrow is just another morning.`);
  }
}
