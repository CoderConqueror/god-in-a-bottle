import { RNG, rnd, ri, pick, chance, shuffled } from './rng';
import type { WorldCulture, Domain, Sex } from './types';

// Each world rolls its own phoneme palette, so cultures sound different across seeds.
const ONSETS = [
  ['k', 'kh', 't', 'th', 'r', 'sh', 'm', 'n', 'v', 'z'],
  ['b', 'd', 'g', 'l', 'm', 'n', 'r', 's', 'v', 'y'],
  ['f', 'h', 'l', 'w', 's', 'th', 'r', 'm', 'n', 'd'],
  ['p', 't', 'k', 'ch', 'ts', 'm', 'n', 'h', 'y', 'w'],
  ['gr', 'br', 'dr', 'k', 'v', 'z', 'm', 'n', 'r', 'l'],
];
const NUCLEI = [
  ['a', 'e', 'i', 'o', 'u', 'ae', 'ia'],
  ['a', 'o', 'u', 'aa', 'ou', 'e'],
  ['e', 'i', 'y', 'ei', 'a', 'ie'],
  ['a', 'i', 'o', 'ua', 'io', 'e'],
];
const CODAS = [
  ['n', 'r', 'l', 's', 'th', '', '', ''],
  ['m', 'n', 'k', 'sh', '', '', ''],
  ['l', 'r', 'nd', 'v', '', '', ''],
];
const VALUE_WORDS = [
  'the hearth', 'the tide', 'silence', 'the ancestors', 'the open sky', 'stonecraft',
  'song', 'the hunt', 'hospitality', 'memory', 'the river', 'endurance', 'starlight',
  'oaths', 'the harvest', 'wandering', 'dreams', 'the forge', 'kinship', 'omens',
];

export function makeCulture(r: RNG): WorldCulture {
  const on = shuffled(r, pick(r, ONSETS)).slice(0, 7);
  const nu = shuffled(r, pick(r, NUCLEI)).slice(0, 5);
  const co = shuffled(r, pick(r, CODAS)).slice(0, 5);
  const syll: string[] = [];
  for (const o of on) for (const n of nu) syll.push(o + n);
  const endings: string[] = [];
  for (const n of nu) for (const c of co) endings.push(n + c);
  return {
    syll: shuffled(r, syll).slice(0, 24),
    endings: shuffled(r, endings).slice(0, 12),
    values: shuffled(r, VALUE_WORDS).slice(0, 6),
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function word(r: RNG, c: WorldCulture, minSyl: number, maxSyl: number): string {
  const n = ri(r, minSyl, maxSyl);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(r, c.syll);
  s += pick(r, c.endings);
  return cap(s);
}

export function personName(r: RNG, c: WorldCulture, sex: Sex): string {
  let n = word(r, c, 1, 2);
  if (sex === 'f' && chance(r, 0.5)) n += pick(r, ['a', 'i', 'e', 'ya']);
  return n;
}

const PLACE_SUFFIX = ['', '', '', ' Rest', ' Hollow', ' Reach', ' Landing', ' Rise', ' Ford', ' Watch'];
export function placeName(r: RNG, c: WorldCulture): string {
  return word(r, c, 1, 2) + pick(r, PLACE_SUFFIX);
}

export function worldNameGen(r: RNG, c: WorldCulture): string {
  return word(r, c, 2, 3);
}

const DEITY_TITLES: Record<Domain, { grace: string[]; wrath: string[]; both: string[] }> = {
  harvest: {
    grace: ['the Provider', 'Bread-Mother', 'the Open Hand', 'Keeper of the Full Bowl'],
    wrath: ['the Withholder', 'the Hungry One', 'Lord of Empty Fields'],
    both: ['of the Turning Fields', 'Giver and Taker of Grain'],
  },
  storm: {
    grace: ['the Rain-Bringer', 'Cloud-Shepherd', 'the Quenching Voice'],
    wrath: ['the Dry Wind', 'Storm-Father', 'the Parching Eye'],
    both: ['of Rain and Dust', 'Who Opens and Seals the Sky'],
  },
  death: {
    grace: ['the Gentle Ferry', 'Keeper of the Quiet Door'],
    wrath: ['the Pale Visitor', 'the Reaper of Houses', 'Breath-Taker'],
    both: ['of the Threshold', 'Who Counts the Living'],
  },
  sky: {
    grace: ['the Lantern-Bearer', 'Star-Herald', 'the Bright Wanderer'],
    wrath: ['the Devourer of Light', 'the Black Sun'],
    both: ['of Signs and Silences', 'Whose Eye Opens at Night'],
  },
  wisdom: {
    grace: ['the Whisperer', 'Flame-of-Thought', 'the First Teacher'],
    wrath: ['the Riddling One', 'Keeper of Locked Doors'],
    both: ['of the Unwritten Book', 'Who Speaks in Dreams'],
  },
  earth: {
    grace: ['the Rooted One', 'Hearth-Warden', 'the Still Ground'],
    wrath: ['the Shaker Below', 'the Cold Stone'],
    both: ['of the Deep Places', 'On Whom All Stand'],
  },
};

export function deityName(r: RNG, c: WorldCulture, domain: Domain, lean: 'grace' | 'wrath' | 'both'): { name: string; title: string } {
  const name = word(r, c, 2, 2);
  const pool = DEITY_TITLES[domain][lean];
  return { name, title: pick(r, pool) };
}

export const TRAITS = ['devout', 'curious', 'brave', 'gentle', 'proud', 'wandering', 'cunning', 'stoic', 'fervent', 'dreaming'] as const;

export function pickTraits(r: RNG): string[] {
  const t = shuffled(r, TRAITS as unknown as string[]);
  return [t[0], t[1]];
}
