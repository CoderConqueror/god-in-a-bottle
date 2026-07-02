import { rnd, ri, pick, chance } from './rng';
import { SimState, Settlement, Deity, Myth, Domain, MythKind, yearOf, seasonOf, SEASONS, dist } from './types';
import { deityName } from './names';
import { addEvent, pushEra } from './chronicle';

// ---------------------------------------------------------------------
// Signals: every divine act (and some natural shocks) leaves a trace.
// Repeated traces in one domain crystallize into a god.
// ---------------------------------------------------------------------

export function recordSignal(st: SimState, domain: Domain, grace: number, wrath: number, sid: number | null): void {
  const sig = st.signals[domain];
  sig.grace += grace;
  sig.wrath += wrath;
  sig.count++;
  if (sid !== null) {
    const s = st.settlements.find(x => x.id === sid && !x.razed);
    if (s) { s.graceSeen += grace; s.wrathSeen += wrath; }
  } else {
    for (const s of st.settlements) {
      if (s.razed) continue;
      s.graceSeen += grace * 0.5;
      s.wrathSeen += wrath * 0.5;
    }
  }
  const d = st.deities.find(x => x.domain === domain);
  if (d) { d.grace += grace; d.wrath += wrath; }
  maybeEmergeDeity(st, domain, sid);
}

function maybeEmergeDeity(st: SimState, domain: Domain, sid: number | null): void {
  if (st.deities.some(d => d.domain === domain && !d.faded)) return;
  const sig = st.signals[domain];
  const weight = sig.grace + sig.wrath;
  if (sig.count < 3 || weight < 5) return;
  const anyFaith = st.settlements.some(s => !s.razed && s.faith > 12);
  if (!anyFaith) return;

  const lean: 'grace' | 'wrath' | 'both' =
    sig.grace > sig.wrath * 1.8 ? 'grace' : sig.wrath > sig.grace * 1.8 ? 'wrath' : 'both';
  const { name, title } = deityName(st.rng, st.culture, domain, lean);
  const deity: Deity = {
    id: st.nextId++,
    name, title, domain,
    grace: sig.grace, wrath: sig.wrath,
    worship: 0,
    year: yearOf(st.tick),
    epithets: [title],
    faded: false,
    fade: 0,
  };
  st.deities.push(deity);

  // the ledger closes its open questions: this is what they decided you were
  for (const led of st.ledger) {
    if (led.domain === domain && led.interpretation === null) {
      led.interpretation = `Folded into the naming of ${name}, ${title}.`;
    }
  }

  // The settlement that witnessed the most adopts the god first.
  const witnesses = st.settlements.filter(s => !s.razed);
  witnesses.sort((a, b) => (b.graceSeen + b.wrathSeen) - (a.graceSeen + a.wrathSeen));
  for (const s of witnesses) {
    if (s.patron === null) { s.patron = deity.id; s.faith = Math.min(100, s.faith + 15); }
  }
  const first = sid !== null ? st.settlements.find(s => s.id === sid) : witnesses[0];
  addEvent(st, 'deity', 3,
    `In ${first ? first.name : 'the settlements'}, the priests have given the pattern a name. They call it ${name}, ${title} — and they say it has always been watching.`,
    first ? first.id : null);
  addMyth(st, 'myth', `The Naming of ${name}`,
    `When the signs came again and again — ${describeSignals(st, domain)} — the elders agreed that no chance could explain them. So ${name} was named, ${title}, and the first offerings were laid out under the open sky.`,
    deity.id);
  if (st.deities.length === 1) pushEra(st, 'The Age of Signs', 'The people begin to believe something watches them.');
}

function describeSignals(st: SimState, domain: Domain): string {
  const m: Record<Domain, string> = {
    harvest: 'fields that ripened beyond reason, or withered without cause',
    storm: 'rains that answered no season, skies that opened and sealed',
    death: 'sickness that chose some houses and spared others',
    sky: 'lights and darknesses moving where no star should move',
    wisdom: 'ideas arriving whole, in dreams, to unlettered minds',
    earth: 'ground that hummed underfoot at the holy places',
  };
  return m[domain];
}

export function addMyth(st: SimState, kind: MythKind, title: string, text: string, deityId: number | null, data?: Myth['data']): Myth {
  const m: Myth = { id: st.nextId++, year: yearOf(st.tick), kind, title, text, deityId, active: true, data };
  st.myths.push(m);
  // retellings reach back into the divine ledger
  if ((kind === 'myth' || kind === 'legend' || kind === 'taboo' || kind === 'cult') && st.ledger.length) {
    const deity = st.deities.find(d => d.id === deityId);
    for (let i = st.ledger.length - 1; i >= 0 && i >= st.ledger.length - 6; i--) {
      const led = st.ledger[i];
      if (led.interpretation !== null) continue;
      if (st.tick - led.tick > 240) break;
      if (deity ? deity.domain === led.domain : true) {
        led.interpretation = `Retold as “${title}.”`;
        break;
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------------
// Rituals & festivals: once worship is strong, belief becomes practice —
// and practice has mechanical teeth (morale, faith, cohesion, food).
// ---------------------------------------------------------------------

const RITUAL_SEASON: Record<Domain, number> = { harvest: 2, storm: 0, death: 3, sky: 1, wisdom: 3, earth: 0 };
const RITUAL_NAME: Record<Domain, string> = {
  harvest: 'the Feast of First Sheaves',
  storm: 'the Rain-Calling',
  death: 'the Night of Remembered Names',
  sky: 'the Vigil of the Open Eye',
  wisdom: 'the Speaking of Riddles',
  earth: 'the Walking of the Bounds',
};

function maybeCreateRitual(st: SimState, deity: Deity): void {
  if (st.myths.some(m => m.kind === 'ritual' && m.deityId === deity.id)) return;
  if (deity.worship < 90) return;
  const season = RITUAL_SEASON[deity.domain];
  addMyth(st, 'ritual', RITUAL_NAME[deity.domain],
    `Each ${SEASONS[season].toLowerCase()}, the followers of ${deity.name} hold ${RITUAL_NAME[deity.domain]}: a portion of the stores is given up, songs are sung, and for a while every quarrel in the settlement is set down. The old say ${deity.name} listens most closely on that night.`,
    deity.id, { season });
  addEvent(st, 'ritual', 2, `The followers of ${deity.name} have begun observing ${RITUAL_NAME[deity.domain]} each ${SEASONS[season].toLowerCase()}.`);
}

function applyRituals(st: SimState): void {
  const season = seasonOf(st.tick);
  for (const m of st.myths) {
    if (!m.active || (m.kind !== 'ritual' && m.kind !== 'festival') || m.data?.season !== season) continue;
    for (const s of st.settlements) {
      if (s.razed || s.patron !== m.deityId) continue;
      const tithe = Math.min(s.food * 0.04, s.pop * 0.4);
      s.food -= tithe;
      s.morale = Math.min(100, s.morale + 5);
      s.faith = Math.min(100, s.faith + 4);
      s.cohesion = Math.min(100, s.cohesion + 3);
    }
  }
}

// ---------------------------------------------------------------------
// Taboos: trauma calcifies into rules of life.
// ---------------------------------------------------------------------

const TABOO_TEXT: Record<string, { title: string; text: (s: Settlement) => string }> = {
  death: {
    title: 'The Unburned Threshold',
    text: s => `After the dying came twice to ${s.name}, it became law: the dead must be carried out by the western path and given to water, never fire, and their names may not be spoken until the next new year. Households that keep the rule are said to be passed over.`,
  },
  storm: {
    title: 'The Far Fields Left Fallow',
    text: s => `Twice the sky betrayed ${s.name}. Now the outermost fields are left unsown as a standing offering, whatever the hunger — for a field given freely, the elders say, is a field that cannot be taken.`,
  },
  harvest: {
    title: 'The First Sheaf Rule',
    text: s => `In ${s.name} no one may eat of a new harvest until the first sheaf has stood a full night at the shrine. Children who forget are made to fast a day; the harvest itself, they believe, remembers.`,
  },
  sky: {
    title: 'The Silence Under Omens',
    text: s => `When lights move wrongly in the sky, all of ${s.name} falls silent — no hammering, no argument, no song — until the next dawn. To make noise under an omen is to draw its eye.`,
  },
  wisdom: {
    title: 'The Unspoken Craft',
    text: s => `In ${s.name}, certain knowledge may only pass from master to a single sworn student, and never be written where strangers might read it.`,
  },
  earth: {
    title: 'The Untrodden Ground',
    text: s => `A ring of ground near ${s.name} may not be built upon, ploughed, or crossed after dark. It belongs, the elders say, to what is under it.`,
  },
};

export function maybeTaboo(st: SimState, s: Settlement, domain: Domain): void {
  const key = TABOO_TEXT[domain] ? domain : 'earth';
  if (s.taboos.length >= 2) return;
  const existing = st.myths.filter(m => m.kind === 'taboo' && m.data?.sid === s.id);
  if (existing.some(m => m.title === TABOO_TEXT[key].title)) return;
  const m = addMyth(st, 'taboo', TABOO_TEXT[key].title, TABOO_TEXT[key].text(s), s.patron, { sid: s.id });
  s.taboos.push(m.id);
  s.cohesion = Math.min(100, s.cohesion + 6);
  s.faith = Math.min(100, s.faith + 5);
  addEvent(st, 'taboo', 2, `A new law of life takes hold in ${s.name}: ${m.title}.`, s.id);
}

// ---------------------------------------------------------------------
// Prophecy: mystics stake belief on the future. Fulfilment vindicates
// the faith; failure corrodes it and invites schism.
// ---------------------------------------------------------------------

const PROPHECY_DEFS: { cond: string; text: (deity: string, w: string) => string }[] = [
  { cond: 'comet', text: (d, w) => `"A burning lamp shall cross the night, and all ${w} shall see it. When it comes, know that ${d} has not turned away."` },
  { cond: 'eclipse', text: (d, w) => `"The sun shall be swallowed and given back. On that day the proud will kneel in the fields of ${w}."` },
  { cond: 'rain', text: (d) => `"The sky shall open when hope is thinnest. ${d} keeps the rain in a sealed jar, and will pour it out."` },
  { cond: 'plague_end', text: (d) => `"The pale visitor shall be turned from the door, and the houses it marked shall fill with children again, by the hand of ${d}."` },
  { cond: 'war_end', text: (_, w) => `"The spears of ${w} shall be beaten into boat-nails, and enemies shall eat from one pot before the speaker of these words is old."` },
  { cond: 'golden', text: (_, w) => `"${w} shall grow until the smoke of its hearths is a second cloud, and no child shall know hunger by name."` },
];

export function maybeProphecy(st: SimState, s: Settlement): void {
  const alive = st.deities.filter(d => !d.faded);
  if (alive.length === 0) return;
  if (st.myths.filter(m => m.kind === 'prophecy' && m.data?.fulfilled === null).length >= 2) return;
  const deity = alive.find(d => d.id === s.patron) ?? pick(st.rng, alive);
  const def = pick(st.rng, PROPHECY_DEFS);
  const prophets = st.people.filter(p => p.home === s.id && p.faith > 60 && p.age > 25);
  const prophet = prophets.length ? pick(st.rng, prophets) : null;
  const pname = prophet ? prophet.name : 'an unnamed wanderer';
  if (prophet) { prophet.renown += 8; prophet.prof = 'prophet'; addMemory(prophet, `Spoke a prophecy in year ${yearOf(st.tick)}`); }
  const deadline = st.tick + ri(st.rng, 40, 80);
  addMyth(st, 'prophecy', `The Prophecy of ${pname}`,
    `${pname} of ${s.name} stood in the market and spoke: ${def.text(deity.name, st.worldName)}`,
    deity.id, { cond: def.cond, deadline, fulfilled: null, sid: s.id });
  addEvent(st, 'prophecy', 3, `${pname} of ${s.name} has spoken a prophecy in the name of ${deity.name}. The settlement holds its breath.`, s.id);
}

// Engine and interventions call this whenever a matching condition occurs.
export function notifyCondition(st: SimState, cond: string): void {
  for (const m of st.myths) {
    if (m.kind !== 'prophecy' || m.data?.fulfilled !== null || m.data?.cond !== cond) continue;
    m.data.fulfilled = true;
    const deity = st.deities.find(d => d.id === m.deityId);
    addEvent(st, 'prophecy', 3, `${m.title} has come to pass. ${deity ? deity.name + ' is exalted; doubters fall silent.' : 'The faithful are vindicated.'}`);
    const recent = st.ledger[st.ledger.length - 1];
    if (recent && st.tick - recent.tick < 6 && recent.echoes.length < 4) {
      recent.echoes.push(`${m.title} was proclaimed fulfilled by this sign — belief hardened around your act like amber.`);
    }
    for (const s of st.settlements) {
      if (s.razed) continue;
      s.faith = Math.min(100, s.faith + 14);
      s.morale = Math.min(100, s.morale + 8);
      s.cohesion = Math.min(100, s.cohesion + 6);
      for (const oid of Object.keys(s.tension)) s.tension[+oid] = Math.max(0, s.tension[+oid] - 12);
    }
    if (deity) deity.grace += 2;
  }
}

function expireProphecies(st: SimState): void {
  for (const m of st.myths) {
    if (m.kind !== 'prophecy' || m.data?.fulfilled !== null) continue;
    if (m.data && m.data.deadline !== undefined && st.tick > m.data.deadline) {
      m.data.fulfilled = false;
      addEvent(st, 'prophecy', 2, `${m.title} has failed. Its words are repeated now only in mockery, and the shrines are a little emptier.`);
      for (const s of st.settlements) {
        if (s.razed) continue;
        s.faith = Math.max(0, s.faith - 9);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Schism: the same god, read differently by the blessed and the struck.
// ---------------------------------------------------------------------

function maybeSchism(st: SimState): void {
  for (const deity of st.deities) {
    if (st.myths.some(m => m.kind === 'schism' && m.deityId === deity.id)) continue;
    const flock = st.settlements.filter(s => !s.razed && s.patron === deity.id);
    if (flock.length < 2) continue;
    const bright = flock.filter(s => s.graceSeen > s.wrathSeen + 4);
    const ash = flock.filter(s => s.wrathSeen > s.graceSeen + 4);
    if (!bright.length || !ash.length) continue;
    if (!chance(st.rng, 0.35)) continue;
    for (const s of bright) s.sect = 'Bright-Way';
    for (const s of ash) s.sect = 'Ash-Way';
    const a = bright[0], b = ash[0];
    a.relations[b.id] = (a.relations[b.id] ?? 0) - 35;
    b.relations[a.id] = (b.relations[a.id] ?? 0) - 35;
    a.tension[b.id] = (a.tension[b.id] ?? 0) + 20;
    b.tension[a.id] = (b.tension[a.id] ?? 0) + 20;
    addMyth(st, 'schism', `The Two Ways of ${deity.name}`,
      `${a.name} teaches that ${deity.name} is generous and asks only gratitude — the Bright Way. ${b.name}, which has buried too many, teaches that ${deity.name} must be appeased with vigilance and denial — the Ash Way. Each calls the other's rite an insult to the god. Families no longer marry across the two ways.`,
      deity.id);
    addEvent(st, 'schism', 3, `The faith of ${deity.name} has split: ${a.name} follows the Bright Way, ${b.name} the Ash Way. Old friendships curdle into doctrine.`);
  }
}

// ---------------------------------------------------------------------
// Story-myths and hero legends, woven from real chronicle entries.
// ---------------------------------------------------------------------

function maybeStoryMyth(st: SimState): void {
  if (!chance(st.rng, 0.12)) return;
  const recent = st.events.filter(e => e.imp >= 2 && st.tick - e.tick < 60 && e.type !== 'era' && e.type !== 'myth');
  if (!recent.length) return;
  const ev = pick(st.rng, recent);
  if (st.myths.some(m => m.data?.sid === ev.id)) return;
  const aliveD = st.deities.filter(d => !d.faded);
  const deity = aliveD.length ? pick(st.rng, aliveD) : null;
  const attribution = deity
    ? pick(st.rng, [
      `The tale-keepers say this was the work of ${deity.name}, ${deity.title}.`,
      `In the telling, it is ${deity.name} who moves behind every part of it.`,
      `Children are taught that ${deity.name} arranged it so, for reasons the living are not owed.`,
    ])
    : pick(st.rng, [
      `The tale-keepers say something unseen arranged it so.`,
      `No one can say why; the story is told anyway, and grows.`,
    ]);
  addMyth(st, 'myth', `The Story of the ${pick(st.rng, ['Turning', 'Long', 'Strange', 'Remembered', 'Whispered'])} ${SEASONS[ev.season]}`,
    `It is told in ${st.worldName}: ${ev.text} ${attribution}`,
    deity ? deity.id : null, { sid: ev.id });
}

export function makeLegend(st: SimState, title: string, text: string, deityId: number | null = null): void {
  addMyth(st, 'legend', title, text, deityId);
}

// ---------------------------------------------------------------------
// Pilgrimage: sacred places pull people together (or into rivalry).
// ---------------------------------------------------------------------

function pilgrimage(st: SimState): void {
  if (seasonOf(st.tick) !== 1) return; // summer roads
  for (const site of st.sacred) {
    const near = st.settlements.filter(s => !s.razed && dist(s.x, s.y, site.x, site.y) < 20);
    if (near.length === 0) continue;
    for (const s of near) {
      s.morale = Math.min(100, s.morale + 2);
      s.faith = Math.min(100, s.faith + 2);
    }
    // shared shrines knit settlements of the same patron together
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      if (a.patron !== null && a.patron === b.patron && a.sect === b.sect) {
        a.relations[b.id] = Math.min(100, (a.relations[b.id] ?? 0) + 2);
        b.relations[a.id] = Math.min(100, (b.relations[a.id] ?? 0) + 2);
      } else if (a.patron !== b.patron || a.sect !== b.sect) {
        a.tension[b.id] = Math.min(100, (a.tension[b.id] ?? 0) + 1.5);
        b.tension[a.id] = Math.min(100, (b.tension[a.id] ?? 0) + 1.5);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Conversion drift + worship + the yearly religious heartbeat.
// ---------------------------------------------------------------------

function conversions(st: SimState): void {
  const alive = st.deities.filter(d => !d.faded);
  if (alive.length === 0) return;
  for (const s of st.settlements) {
    if (s.razed) continue;
    if (s.patron === null && s.faith > 30 && chance(st.rng, 0.15)) {
      // adopt the god its neighbors follow, or the strongest
      const near = st.settlements.filter(o => !o.razed && o.patron !== null && dist(o.x, o.y, s.x, s.y) < 16);
      const deity = (near.length ? alive.find(d => d.id === near[0].patron) : undefined)
        ?? alive.slice().sort((a, b) => b.worship - a.worship)[0];
      s.patron = deity.id;
      addEvent(st, 'faith', 2, `${s.name} has raised its first altar to ${deity.name}.`, s.id);
    }
  }
}

export function religionTick(st: SimState): void {
  applyRituals(st);
  if (seasonOf(st.tick) === 3) { // yearly bookkeeping in winter
    for (const d of st.deities) {
      if (d.faded) continue;
      d.worship = st.settlements.reduce((acc, s) => acc + (!s.razed && s.patron === d.id ? s.faith * (1 + s.pop / 60) : 0), 0);
      maybeCreateRitual(st, d);
      // gods live on attention; without it their names wear smooth
      if (d.worship < 5 && yearOf(st.tick) - d.year > 50) d.fade++;
      else d.fade = 0;
      if (d.fade > 30) {
        d.faded = true;
        for (const s of st.settlements) if (s.patron === d.id) { s.patron = null; s.sect = null; }
        for (const m of st.myths) if (m.deityId === d.id && (m.kind === 'ritual' || m.kind === 'festival')) m.active = false;
        st.signals[d.domain].grace *= 0.4;
        st.signals[d.domain].wrath *= 0.4;
        st.signals[d.domain].count = 0;
        addMyth(st, 'legend', `The Forgetting of ${d.name}`,
          `There was a god once called ${d.name}, ${d.title}. The rites lapsed in a busy generation, then the reasons for the rites, then the name itself — it survives only in three place-names and one lullaby whose words no longer mean anything. This is how gods die: not killed, but unattended.`,
          d.id);
        addEvent(st, 'faith', 3, `No shrine has burned an offering to ${d.name} in thirty years. The old god's name is worn smooth, and the sky it governed stands unexplained again.`);
      }
    }
    conversions(st);
    maybeSchism(st);
    maybeStoryMyth(st);
    expireProphecies(st);
    // prophets arise where faith runs hot
    for (const s of st.settlements) {
      if (s.razed) continue;
      if (s.faith > 55 && chance(st.rng, 0.05)) maybeProphecy(st, s);
      // signs fade from living memory
      s.graceSeen *= 0.97;
      s.wrathSeen *= 0.97;
    }
  }
  pilgrimage(st);
}

export function addMemory(p: { memories: string[] }, m: string): void {
  p.memories.push(m);
  if (p.memories.length > 5) p.memories.shift();
}
