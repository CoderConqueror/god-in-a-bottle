import { ri, pick, chance } from './rng';
import { SimState, Settlement, Domain, SacredSite, yearOf, idx, dist } from './types';
import { addEvent } from './chronicle';
import { recordSignal, notifyCondition, maybeTaboo, addMyth, addMemory } from './myth';
import { refreshPop, living, TECHS, hasTech } from './engine';
import { placeName } from './names';

export type TargetKind = 'settlement' | 'tile' | 'global';

export interface InterventionDef {
  id: string;
  name: string;
  icon: string;
  cost: number;
  cooldownYears: number;
  target: TargetKind;
  domain: Domain;
  desc: string;
  whisper: string; // flavor line shown in the panel
}

export const INTERVENTIONS: InterventionDef[] = [
  {
    id: 'omen', name: 'Omen', icon: '◉', cost: 8, cooldownYears: 1, target: 'settlement', domain: 'sky',
    desc: 'A sign only they will see: birds flying wrong, a calf born marked. Softens their intent — how they read it is theirs.',
    whisper: 'The cheapest word in your language.',
  },
  {
    id: 'rain', name: 'Rain', icon: '☂', cost: 15, cooldownYears: 2, target: 'global', domain: 'storm',
    desc: 'Open the sky. Ends drought and quickens every field — but rivers remember too much water.',
    whisper: 'Mercy, in the shape of weather.',
  },
  {
    id: 'bless', name: 'Bless Harvest', icon: '✳', cost: 18, cooldownYears: 3, target: 'settlement', domain: 'harvest',
    desc: 'Two years of impossible abundance for one settlement. Full bellies make more mouths.',
    whisper: 'Generosity has consequences.',
  },
  {
    id: 'curse', name: 'Curse', icon: '⌁', cost: 20, cooldownYears: 6, target: 'settlement', domain: 'death',
    desc: 'Misfortune clings to one settlement: accidents, gloom, thin yields. They will look for someone to blame.',
    whisper: 'A thumb pressed on one small scale.',
  },
  {
    id: 'drought', name: 'Drought', icon: '☀', cost: 20, cooldownYears: 5, target: 'global', domain: 'storm',
    desc: 'Seal the sky. Fields wither everywhere; those without rivers will envy those with them.',
    whisper: 'Scarcity is a sculptor.',
  },
  {
    id: 'inspire', name: 'Inspire Leader', icon: '✦', cost: 22, cooldownYears: 8, target: 'settlement', domain: 'wisdom',
    desc: 'Fill one leader with vision for a decade: invention, unity, ambition. Ambition cuts both ways.',
    whisper: 'Great souls are rarely safe ones.',
  },
  {
    id: 'eclipse', name: 'Eclipse', icon: '●', cost: 25, cooldownYears: 10, target: 'global', domain: 'sky',
    desc: 'Swallow the sun at midday. Awe floods every shrine; wars pause; the credulous panic.',
    whisper: 'Nothing converts like darkness at noon.',
  },
  {
    id: 'consecrate', name: 'Consecrate Land', icon: '⬟', cost: 30, cooldownYears: 10, target: 'tile', domain: 'earth',
    desc: 'Mark ground as holy forever. Pilgrims will come; settlements will grow toward it — or fight over it.',
    whisper: 'Geography is theology.',
  },
  {
    id: 'miracle', name: 'Miracle', icon: '❋', cost: 30, cooldownYears: 8, target: 'settlement', domain: 'harvest',
    desc: 'The sick stand up. Plague ends, hearts lift, and the place may become a shrine to what you did.',
    whisper: 'The kindest thing you can be caught doing.',
  },
  {
    id: 'reveal', name: 'Reveal Knowledge', icon: '✎', cost: 35, cooldownYears: 12, target: 'settlement', domain: 'wisdom',
    desc: 'Slip a finished idea into a dreaming mind. Progress leaps ahead — and every tool is also a weapon.',
    whisper: 'They will call it genius.',
  },
  {
    id: 'plague', name: 'Plague', icon: '☠', cost: 35, cooldownYears: 15, target: 'settlement', domain: 'death',
    desc: 'Send the pale visitor to one settlement. Fewer mouths, emptier lanes, and a religion permanently changed.',
    whisper: 'You will not be forgiven. You will be worshipped.',
  },
  {
    id: 'comet', name: 'Comet', icon: '☄', cost: 45, cooldownYears: 25, target: 'global', domain: 'sky',
    desc: 'Drag a burning lamp across every night for a season. Prophecies ignite; cults are born; nothing is read small.',
    whisper: 'The loudest thing you can say without words.',
  },
];

export function interventionById(id: string): InterventionDef | undefined {
  return INTERVENTIONS.find(i => i.id === id);
}

export interface ApplyResult { ok: boolean; msg: string }

export function applyIntervention(st: SimState, id: string, target?: { sid?: number; x?: number; y?: number }): ApplyResult {
  const def = interventionById(id);
  if (!def) return { ok: false, msg: 'Unknown intervention.' };
  if (st.ended) return { ok: false, msg: 'The chronicle has closed.' };
  if (st.influence < def.cost) return { ok: false, msg: 'Not enough influence.' };
  if ((st.cooldowns[id] ?? 0) > st.tick) return { ok: false, msg: 'This power is still spent.' };

  let s: Settlement | undefined;
  if (def.target === 'settlement') {
    s = st.settlements.find(x => x.id === target?.sid && !x.razed);
    if (!s) return { ok: false, msg: 'Choose a living settlement.' };
  }
  let tx = target?.x ?? -1, ty = target?.y ?? -1;
  if (def.target === 'tile') {
    if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) return { ok: false, msg: 'Choose a place on the island.' };
    const t = st.tiles[idx(st, tx, ty)];
    if (t.t === 'ocean') return { ok: false, msg: 'The sea keeps its own gods.' };
    if (t.sacredId !== null) return { ok: false, msg: 'That ground is already holy.' };
  }

  st.influence -= def.cost;
  st.cooldowns[id] = st.tick + def.cooldownYears * 4;
  st.interventionsUsed++;
  st.usedByKind[def.name] = (st.usedByKind[def.name] ?? 0) + 1;

  switch (def.id) {
    case 'bless': {
      const b = s!;
      b.blessed = 8;
      b.boom = 16;
      b.morale = Math.min(100, b.morale + 8);
      recordSignal(st, 'harvest', 2, 0, b.id);
      addEvent(st, 'divine', 2, `The fields of ${b.name} come in heavy beyond any elder's memory. Grain bends the poles of the drying racks. No one can explain it; everyone tries.`, b.id);
      return { ok: true, msg: `${b.name} will not hunger for a while.` };
    }
    case 'rain': {
      const wasDry = st.weather.drought > 0.8;
      st.weather.drought = 0;
      st.weather.rain += 2.2;
      st.weather.rainUses.push(st.tick);
      st.weather.rainUses = st.weather.rainUses.filter(t2 => st.tick - t2 < 10);
      recordSignal(st, 'storm', 1.6, 0, null);
      notifyCondition(st, 'rain');
      addEvent(st, 'divine', 2, wasDry
        ? `The sky breaks open at last. People stand in the downpour with their mouths open, laughing and weeping at once.`
        : `Long, generous rains sweep the island. Cisterns brim; the rivers run loud all night.`, null);
      if (st.weather.rainUses.length >= 2) {
        st.delayed.push({ tick: st.tick + 2, kind: 'flood' });
      }
      return { ok: true, msg: 'The sky opens.' };
    }
    case 'drought': {
      st.weather.rain = 0;
      st.weather.drought += 2.4;
      recordSignal(st, 'storm', 0, 1.8, null);
      st.delayed.push({ tick: st.tick + 8, kind: 'droughtBites' });
      addEvent(st, 'divine', 2, `The rains simply stop. Week after cloudless week, the island watches its green turn to straw and starts counting jars.`, null);
      return { ok: true, msg: 'The sky is sealed.' };
    }
    case 'inspire': {
      const b = s!;
      b.inspired = 40;
      b.cohesion = Math.min(100, b.cohesion + 10);
      const leader = st.people.find(p => p.id === b.leader) ?? st.people.filter(p => p.home === b.id && p.age > 20)[0];
      if (leader) {
        leader.renown += 12;
        leader.faith = Math.min(100, leader.faith + 20);
        addMemory(leader, `Began dreaming true in year ${yearOf(st.tick)}`);
        addEvent(st, 'divine', 2, `${leader.name} of ${b.name} wakes changed — speaking of canals and granaries and stars as if reading from a book no one else can see. People follow, half in awe, half in fear.`, b.id);
        st.delayed.push({ tick: st.tick + 44, kind: 'visionFades', a: b.id });
      }
      recordSignal(st, 'wisdom', 1.5, 0.5, b.id);
      return { ok: true, msg: 'A mind catches fire.' };
    }
    case 'reveal': {
      const b = s!;
      const nextTech = TECHS.find(t => !hasTech(st, t.id) && (!t.req || hasTech(st, t.req)));
      recordSignal(st, 'wisdom', 2, 0, b.id);
      if (nextTech) {
        st.techs[nextTech.id] = yearOf(st.tick);
        b.knowledge += 40;
        const dreamer = st.people.filter(p => p.home === b.id && p.age > 16);
        const who = dreamer.length ? pick(st.rng, dreamer) : null;
        if (who) { who.renown += 14; addMemory(who, `Dreamed the secret of ${nextTech.name}`); }
        addEvent(st, 'tech', 3, `${who ? who.name : 'A sleeper'} in ${b.name} dreams the whole of ${nextTech.name} in one night and wakes weeping. Within a season it is everywhere. ${nextTech.desc}`, b.id);
        return { ok: true, msg: `${nextTech.name} arrives generations early.` };
      }
      b.knowledge += 80;
      addEvent(st, 'divine', 2, `A season of strange lucidity in ${b.name}: apprentices correct masters, and the masters, grudgingly, write it down.`, b.id);
      return { ok: true, msg: 'Understanding deepens.' };
    }
    case 'plague': {
      const b = s!;
      b.plague = ri(st.rng, 8, 13);
      recordSignal(st, 'death', 0, 2.5, b.id);
      addEvent(st, 'plague', 3, `It begins in ${b.name} with a fever that doesn't break. By the new moon there are too few well to tend the sick. They will remember this, and build a religion around remembering.`, b.id);
      st.delayed.push({ tick: st.tick + 24, kind: 'reflection', a: b.id });
      return { ok: true, msg: 'The pale visitor sets out.' };
    }
    case 'eclipse': {
      st.weather.eclipse = 2;
      recordSignal(st, 'sky', 1, 1, null);
      const astr = hasTech(st, 'astronomy');
      for (const x of living(st)) {
        x.faith = Math.min(100, x.faith + (astr ? 6 : 12));
        x.morale = Math.max(0, x.morale - (astr ? 2 : 8));
        if (astr) x.knowledge += 15;
        if (x.warWith !== null) {
          const foe = st.settlements.find(y => y.id === x.warWith);
          if (foe) {
            x.truce[foe.id] = st.tick + 6;
            foe.truce[x.id] = st.tick + 6;
            x.warWith = null;
            foe.warWith = null;
            addEvent(st, 'war', 3, `Armies of ${x.name} and ${foe.name} drop their spears where they stand as the sun goes out. No one will give the order to fight under a dead sky.`, null);
          }
        }
      }
      notifyCondition(st, 'eclipse');
      addEvent(st, 'divine', 3, astr
        ? `The sun is swallowed at midday — but this time the star-readers predicted it to the hour, and the island watches in proud, giddy silence instead of terror.`
        : `At midday the sun goes out like a pinched lamp. Birds roost; children scream; every knee on the island finds the ground.`, null);
      return { ok: true, msg: 'Noon becomes midnight.' };
    }
    case 'comet': {
      st.weather.comet = 4;
      recordSignal(st, 'sky', 2, 1, null);
      notifyCondition(st, 'comet');
      for (const x of living(st)) x.faith = Math.min(100, x.faith + 15);
      addEvent(st, 'divine', 3, `A burning lamp crosses the night, trailing a road of light, and returns the next night, and the next. Nothing on ${st.worldName} is talked of but what it asks.`, null);
      // somewhere, someone starts a cult
      const ls = living(st);
      if (ls.length && chance(st.rng, 0.75)) {
        const b = pick(st.rng, ls);
        b.cohesion = Math.max(0, b.cohesion - 8);
        const mystics = st.people.filter(p => p.home === b.id && p.age > 18);
        const founder = mystics.length ? pick(st.rng, mystics) : null;
        if (founder) {
          founder.prof = 'mystic';
          founder.renown += 10;
          addMyth(st, 'cult', `The Lamp-Bearers of ${b.name}`,
            `${founder.name} of ${b.name} gathered those who could not stop watching the sky and taught them: the lamp is a door, and the door is opening. They meet at night, wear ash on their brows, and unsettle their neighbors profoundly.`,
            null, { sid: b.id });
          addEvent(st, 'faith', 2, `A night-gathering cult of Lamp-Bearers forms in ${b.name}, to the alarm of its elders.`, b.id);
        }
      }
      return { ok: true, msg: 'You write across the night sky.' };
    }
    case 'consecrate': {
      const t = st.tiles[idx(st, tx, ty)];
      const site: SacredSite = {
        id: st.nextId++, x: tx, y: ty,
        name: `the Hallowed ${pick(st.rng, ['Grove', 'Hill', 'Spring', 'Stones', 'Field', 'Hollow'])} of ${placeName(st.rng, st.culture)}`,
        year: yearOf(st.tick), deityId: null, kind: 'consecrated',
      };
      st.sacred.push(site);
      t.sacredId = site.id;
      st.terrainV++;
      recordSignal(st, 'earth', 1.8, 0, null);
      const near = living(st).filter(x2 => dist(x2.x, x2.y, tx, ty) < 12);
      for (const x2 of near) x2.faith = Math.min(100, x2.faith + 10);
      const claimants = living(st).filter(x2 => dist(x2.x, x2.y, tx, ty) < 9);
      if (claimants.length >= 2) {
        for (let i2 = 0; i2 < claimants.length; i2++) for (let j2 = i2 + 1; j2 < claimants.length; j2++) {
          claimants[i2].tension[claimants[j2].id] = (claimants[i2].tension[claimants[j2].id] ?? 0) + 12;
          claimants[j2].tension[claimants[i2].id] = claimants[i2].tension[claimants[j2].id];
        }
        addEvent(st, 'divine', 3, `Shepherds report that ${site.name} now hums underfoot and no bird will overfly it. Two settlements have already sent stone-markers to claim the pilgrim road.`, null);
      } else {
        addEvent(st, 'divine', 3, `${site.name} is changed: the air tastes of storms there, and those who sleep on it dream in colors they cannot name. The first pilgrims are already walking.`, null);
      }
      return { ok: true, msg: 'The ground will never be ordinary again.' };
    }
    case 'miracle': {
      const b = s!;
      const hadPlague = b.plague > 0;
      b.plague = 0;
      b.cursed = 0;
      b.morale = Math.min(100, b.morale + 16);
      b.faith = Math.min(100, b.faith + 14);
      b.health = Math.min(100, b.health + 20);
      for (const p of st.people) if (p.home === b.id) { p.health = Math.min(100, p.health + 30); }
      recordSignal(st, 'harvest', 2.2, 0, b.id);
      addEvent(st, 'divine', 3, hadPlague
        ? `In ${b.name}, on a single morning, every fever breaks at once. The sick stand up in their doorways blinking at the sun. Some laugh; most are very quiet.`
        : `A season of impossible good health in ${b.name}: old wounds close, weak children fatten, and not one grave is dug.`, b.id);
      st.delayed.push({ tick: st.tick + 20, kind: 'pilgrimSite', a: b.id });
      return { ok: true, msg: 'The dying stand up.' };
    }
    case 'curse': {
      const b = s!;
      b.cursed = 10;
      b.morale = Math.max(0, b.morale - 12);
      recordSignal(st, 'death', 0, 1.5, b.id);
      addEvent(st, 'divine', 2, `A wrongness settles on ${b.name}. Ropes fray, milk sours, footings slip. Nothing anyone can point to — which is exactly what frightens them.`, b.id);
      st.delayed.push({ tick: st.tick + 12, kind: 'scapegoat', a: b.id });
      return { ok: true, msg: 'Misfortune finds an address.' };
    }
    case 'omen': {
      const b = s!;
      b.faith = Math.min(100, b.faith + 5);
      recordSignal(st, 'sky', 0.5, 0.3, b.id);
      const leader = st.people.find(p => p.id === b.leader);
      const cautious = leader ? !leader.traits.includes('brave') : chance(st.rng, 0.5);
      let reading: string;
      if (cautious) {
        for (const oid of Object.keys(b.tension)) b.tension[+oid] = Math.max(0, (b.tension[+oid] ?? 0) - 18);
        reading = `The elders of ${b.name} read it as a warning: mend fences, sharpen no spears this year.`;
      } else {
        b.morale = Math.min(100, b.morale + 6);
        b.knowledge += 10;
        reading = `The elders of ${b.name} read it as a summons to boldness, and the young sharpen their ambitions.`;
      }
      addEvent(st, 'divine', 1, `Over ${b.name}, a wedge of birds flies against the wind, and a white hind stands in the square at dusk. ${reading}`, b.id);
      return { ok: true, msg: 'A sign is given. The reading is theirs.' };
    }
  }
  return { ok: false, msg: 'Nothing happened.' };
}
