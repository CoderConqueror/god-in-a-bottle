import type { RNG } from './rng';

export type TileType = 'ocean' | 'coast' | 'plain' | 'forest' | 'hills' | 'mountain' | 'dry';

export interface Tile {
  t: TileType;
  elev: number;      // 0..1
  fert: number;      // 0..1.4
  forest: number;    // 0..1 density
  river: boolean;
  sacredId: number | null;
  ruinName: string | null;
}

export interface SacredSite {
  id: number;
  x: number;
  y: number;
  name: string;
  year: number;
  deityId: number | null;
  kind: string; // 'consecrated' | 'miracle' | 'natural'
}

export type Sex = 'm' | 'f';

export interface Person {
  id: number;
  name: string;
  sex: Sex;
  age: number;       // years, advances 0.25/tick
  traits: string[];
  prof: string;
  health: number;    // 0..100
  morale: number;    // 0..100
  faith: number;     // 0..100
  home: number;      // settlement id
  spouse: number | null;
  renown: number;
  memories: string[];
}

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  founded: number;   // year
  faction: string;
  food: number;
  wood: number;
  stone: number;
  knowledge: number;
  morale: number;    // 0..100
  faith: number;     // 0..100
  cohesion: number;  // 0..100
  health: number;    // 0..100 general wellness
  buildings: Record<string, number>;
  relations: Record<number, number>;  // -100..100
  tension: Record<number, number>;    // 0..100
  truce: Record<number, number>;      // tick until which truce holds
  culture: string[];
  patron: number | null;   // deity id
  sect: string | null;
  hunger: number;    // consecutive starving ticks
  plague: number;    // remaining plague ticks
  blessed: number;   // remaining blessed-harvest ticks
  cursed: number;    // remaining curse ticks
  inspired: number;  // remaining inspired-leader ticks
  boom: number;      // fertility-boom ticks (delayed bless ripple)
  graceSeen: number; // beneficial signs witnessed
  wrathSeen: number; // harmful signs witnessed
  leader: number | null;
  wonderName?: string;
  warWith: number | null;
  warStart: number;
  lastSplit: number; // tick of last schism/expedition
  razed: boolean;
  razedYear: number;
  pop: number;       // cached population
  taboos: number[];  // myth ids
  localHistory: number[]; // event ids, capped
}

export type Domain = 'harvest' | 'storm' | 'death' | 'sky' | 'wisdom' | 'earth';

export interface Deity {
  id: number;
  name: string;
  title: string;
  domain: Domain;
  grace: number;
  wrath: number;
  worship: number;
  year: number;      // year of emergence
  epithets: string[];
  faded: boolean;    // forgotten gods leave the pantheon but not the record
  fade: number;      // consecutive lean years
}

export type MythKind = 'myth' | 'legend' | 'ritual' | 'taboo' | 'prophecy' | 'festival' | 'schism' | 'cult';

export interface Road { a: number; b: number }

export interface Scar {
  x: number;
  y: number;
  r: number;          // radius in tiles
  kind: 'burn' | 'fade';
  year: number;
}

export interface LedgerEntry {
  id: number;
  tick: number;
  year: number;
  action: string;      // intervention name
  icon: string;
  targetName: string;
  domain: Domain;
  interpretation: string | null; // how civilization explained it
  echoes: string[];    // consequences that arrived later
}

export interface Myth {
  id: number;
  year: number;
  kind: MythKind;
  title: string;
  text: string;
  deityId: number | null;
  active: boolean;
  data?: {
    cond?: string;        // prophecy condition tag
    deadline?: number;    // tick
    fulfilled?: boolean | null;
    season?: number;      // ritual season
    sid?: number;         // settlement id
  };
}

export interface EventEntry {
  id: number;
  tick: number;
  year: number;
  season: number;
  type: string;
  text: string;
  imp: 1 | 2 | 3;
  sid: number | null;
}

export interface Era {
  name: string;
  startYear: number;
  note: string;
}

export interface HistSample {
  year: number;
  pop: number;
  food: number;
  faith: number;
  knowledge: number;
  settlements: number;
  warDeaths: number;
}

export interface DelayedEffect {
  tick: number;
  kind: string;
  a?: number;
  b?: number;
  s?: string;
  lid?: number; // originating ledger entry, for echo attribution
}

export interface WorldCulture {
  syll: string[];
  endings: string[];
  values: string[];
}

export interface SimState {
  version: number;
  seed: string;
  worldName: string;
  rng: RNG;
  tick: number;
  ended: boolean;
  endText: string | null;
  W: number;
  H: number;
  tiles: Tile[];
  terrainV: number; // bumped when terrain changes (ruins, sacred sites)
  devV: number;     // bumped when development changes (roads, farms, buildings, forests)
  roads: Road[];
  scars: Scar[];
  ledger: LedgerEntry[];
  sacred: SacredSite[];
  people: Person[];
  settlements: Settlement[];
  deities: Deity[];
  myths: Myth[];
  events: EventEntry[];
  eras: Era[];
  influence: number;
  influenceMax: number;
  cooldowns: Record<string, number>; // interventionId -> tick when usable again
  delayed: DelayedEffect[];
  weather: { rain: number; drought: number; eclipse: number; comet: number; rainUses: number[] };
  signals: Record<Domain, { grace: number; wrath: number; count: number }>;
  interventionsUsed: number;
  usedByKind: Record<string, number>;
  techs: Record<string, number>; // techId -> year discovered
  history: HistSample[];
  stats: {
    born: number;
    died: number;
    warDeaths: number;
    plagueDeaths: number;
    famineDeaths: number;
    wars: number;
    peakPop: number;
  };
  nextId: number;
  culture: WorldCulture;
}

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const TICKS_PER_YEAR = 4;
export const END_YEAR = 1200;
export const GRID_W = 128; // world wraps east-west: it is a planet now
export const GRID_H = 64;

export function yearOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR) + 1;
}
export function seasonOf(tick: number): number {
  return tick % TICKS_PER_YEAR;
}
export function idx(st: SimState, x: number, y: number): number {
  return y * st.W + ((x % st.W) + st.W) % st.W;
}
export function inBounds(st: SimState, x: number, y: number): boolean {
  return y >= 0 && y < st.H; // x wraps around the globe
}
export function dist(ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > GRID_W / 2) dx = GRID_W - dx;
  return Math.hypot(dx, ay - by);
}
