import { SimState, EventEntry, SEASONS, yearOf, seasonOf, Domain } from './types';

export function addEvent(st: SimState, type: string, imp: 1 | 2 | 3, text: string, sid: number | null = null): EventEntry {
  const e: EventEntry = {
    id: st.nextId++,
    tick: st.tick,
    year: yearOf(st.tick),
    season: seasonOf(st.tick),
    type,
    text,
    imp,
    sid,
  };
  st.events.push(e);
  if (sid !== null) {
    const s = st.settlements.find(s2 => s2.id === sid);
    if (s) {
      s.localHistory.push(e.id);
      if (s.localHistory.length > 40) s.localHistory.shift();
    }
  }
  // keep the chronicle from growing without bound: prune old minor entries
  if (st.events.length > 1600) {
    const cutoff = st.tick - 240;
    st.events = st.events.filter(ev => ev.imp >= 2 || ev.tick > cutoff);
  }
  return e;
}

export function fmtWhen(e: { year: number; season: number }): string {
  return `Year ${e.year}, ${SEASONS[e.season]}`;
}

// ---- Eras -------------------------------------------------------------

export function pushEra(st: SimState, name: string, note: string): void {
  if (st.eras.length && st.eras[st.eras.length - 1].name === name) return;
  if (st.eras.some(e => e.name === name)) return;
  const prev = st.eras[st.eras.length - 1];
  const year = yearOf(st.tick);
  let retro = '';
  if (prev) {
    const span = year - prev.startYear;
    retro = ` ${prev.name} closes after ${span} ${span === 1 ? 'year' : 'years'}; the world it leaves holds ${st.people.length} souls in ${st.settlements.filter(s => !s.razed).length} settlements.`;
  }
  st.eras.push({ name, startYear: year, note });
  addEvent(st, 'era', 3, `A new age begins: ${name}. ${note}${retro}`);
}

export function currentEra(st: SimState): string {
  return st.eras.length ? st.eras[st.eras.length - 1].name : 'Before Time';
}

// ---- Final summary ----------------------------------------------------

const DOMAIN_WORD: Record<Domain, string> = {
  harvest: 'the harvest', storm: 'the rains', death: 'death', sky: 'the sky', wisdom: 'hidden knowledge', earth: 'the deep earth',
};

export function finalSummary(st: SimState): string[] {
  const paras: string[] = [];
  const alivePop = st.people.length;
  const living = st.settlements.filter(s => !s.razed);
  const extinct = alivePop === 0;

  const years = Math.min(yearOf(st.tick), 100000);
  paras.push(
    extinct
      ? `The world of ${st.worldName} is silent now. For ${years} years a people lived, built, believed, and fought inside the glass — and then the last of them was gone. The bottle holds only wind, ruins, and the memory of names.`
      : `${years >= 1000 ? 'More than a thousand years have' : `${years} years have`} turned inside the glass. The world of ${st.worldName} began with twenty souls stepping from a single boat. It ends with ${alivePop} people in ${living.length} ${living.length === 1 ? 'settlement' : 'settlements'}, heirs to everything that happened between.`
  );

  const s = st.stats;
  paras.push(
    `${s.born} were born and ${s.died} died. Famine took ${s.famineDeaths}, plague took ${s.plagueDeaths}, and ${s.wars === 0 ? 'no war was ever fought' : `${s.wars} ${s.wars === 1 ? 'war' : 'wars'} took ${s.warDeaths} lives`}. At its height the island held ${s.peakPop} people at once.`
  );

  const techCount = Object.keys(st.techs).length;
  if (techCount > 0) {
    const names = Object.keys(st.techs).slice(0, 5).join(', ');
    paras.push(`They learned ${techCount} great arts — among them ${names} — each one changing what came after.`);
  }

  if (st.deities.length > 0) {
    const alive = st.deities.filter(d => !d.faded);
    const forgotten = st.deities.filter(d => d.faded);
    const chief = (alive.length ? alive : st.deities).slice().sort((a, b) => b.worship - a.worship)[0];
    const others = alive.filter(d => d.id !== chief.id);
    let p = `Above all they came to believe in ${chief.name}, ${chief.title}, sovereign of ${DOMAIN_WORD[chief.domain]}`;
    if (others.length) p += `, alongside ${others.map(d => d.name).join(' and ')}`;
    if (forgotten.length) p += `. ${forgotten.length === 1 ? `One god — ${forgotten[0].name} — was worshipped, and then forgotten entirely` : `${forgotten.length} gods were worshipped and then forgotten entirely`}`;
    p += `. ${st.myths.filter(m => m.kind === 'myth' || m.kind === 'legend').length} myths and legends were told, ${st.myths.filter(m => m.kind === 'ritual' || m.kind === 'festival').length} rites observed, ${st.myths.filter(m => m.kind === 'prophecy').length} prophecies spoken.`;
    paras.push(p);
  } else {
    paras.push(`They never gave your work a name. A few spoke of luck, of weather, of the old stones — but no god was ever carved for you. Perhaps that was its own kind of mercy.`);
  }

  if (st.interventionsUsed === 0) {
    paras.push(`You never touched the world. Everything that happened, they did themselves — which may be the strangest miracle of all.`);
  } else {
    const kinds = Object.entries(st.usedByKind).sort((a, b) => b[1] - a[1]);
    const most = kinds[0];
    const grace = st.deities.reduce((acc, d) => acc + d.grace, 0);
    const wrath = st.deities.reduce((acc, d) => acc + d.wrath, 0);
    let judged = 'They never decided whether you were kind.';
    if (grace > wrath * 1.6) judged = 'They remembered you, on the whole, as kind.';
    else if (wrath > grace * 1.6) judged = 'They remembered you, on the whole, as something to be feared.';
    paras.push(
      `You reached into the bottle ${st.interventionsUsed} ${st.interventionsUsed === 1 ? 'time' : 'times'} — most often with ${most[0]}. You never controlled them. But out of your interventions they built gods, rites, taboos, and wars. ${judged}`
    );
  }

  const ruinCount = st.settlements.filter(x => x.razed).length;
  if (ruinCount > 0) {
    paras.push(`${ruinCount} ${ruinCount === 1 ? 'settlement lies' : 'settlements lie'} in ruins, and travellers still name them when they pass.`);
  }

  paras.push(`The glass is quiet. Turn the bottle, and begin again.`);
  return paras;
}
