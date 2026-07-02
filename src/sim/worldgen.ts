import { RNG, rnd, ri, chance } from './rng';
import { SimState, Tile, idx, inBounds } from './types';

// Hash-based value noise, deterministic from an integer seed (independent of RNG stream order).
function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 974634551);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(seed: number, x: number, y: number, oct: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(seed + i * 7919, x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

export function generateTerrain(st: SimState, r: RNG): void {
  const { W, H } = st;
  const seedInt = Math.floor(rnd(r) * 2 ** 31);
  const moistSeed = seedInt + 104729;
  const cx = W / 2, cy = H / 2;
  const tiles: Tile[] = new Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W - 0.5, ny = y / H - 0.5;
      const d = Math.hypot(nx, ny) * 2; // 0 center -> ~1.4 corner
      const wobble = fbm(seedInt + 31, x * 0.09, y * 0.09, 2) * 0.35;
      const falloff = Math.max(0, 1 - Math.pow(d + wobble - 0.18, 2.2));
      let elev = fbm(seedInt, x * 0.07, y * 0.07, 4) * falloff * 1.55 - 0.18;
      elev = Math.max(0, Math.min(1, elev));
      const moist = fbm(moistSeed, x * 0.06, y * 0.06, 3);
      let t: Tile['t'];
      let fert = 0, forest = 0;
      if (elev < 0.16) {
        t = 'ocean';
      } else if (elev < 0.21) {
        t = 'coast';
        fert = 0.45 + moist * 0.3;
      } else if (elev > 0.72) {
        t = 'mountain';
        fert = 0.05;
      } else if (elev > 0.55) {
        t = 'hills';
        fert = 0.25 + moist * 0.25;
        if (moist > 0.55) { forest = (moist - 0.55) * 1.6; }
      } else if (moist < 0.34) {
        t = 'dry';
        fert = 0.15 + moist * 0.3;
      } else if (moist > 0.58) {
        t = 'forest';
        fert = 0.55 + moist * 0.3;
        forest = 0.5 + (moist - 0.58) * 1.2;
      } else {
        t = 'plain';
        fert = 0.6 + moist * 0.45;
      }
      tiles[y * W + x] = {
        t, elev,
        fert: Math.min(1.3, fert),
        forest: Math.min(1, forest),
        river: false,
        sacredId: null,
        ruinName: null,
      };
    }
  }
  st.tiles = tiles;

  // Rivers: descend from high points to the sea, enriching adjacent land.
  const peaks: { x: number; y: number; e: number }[] = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const e = tiles[y * W + x].elev;
    if (e > 0.6) peaks.push({ x, y, e });
  }
  peaks.sort((a, b) => b.e - a.e);
  const nRivers = ri(r, 2, 4);
  const used = new Set<number>();
  let made = 0;
  for (let p = 0; p < peaks.length && made < nRivers; p++) {
    const start = peaks[Math.min(peaks.length - 1, p * 7 + ri(r, 0, 5))];
    if (!start) break;
    let { x, y } = start;
    if (used.has(y * W + x)) continue;
    let steps = 0;
    const path: number[] = [];
    while (steps++ < 120) {
      const i = y * W + x;
      if (tiles[i].t === 'ocean') break;
      path.push(i);
      // pick the lowest neighbor, small random tiebreak
      let bx = x, by = y, be = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx2 = x + dx, ny2 = y + dy;
        if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
        const e = tiles[ny2 * W + nx2].elev + rnd(r) * 0.02;
        if (e < be && !path.includes(ny2 * W + nx2)) { be = e; bx = nx2; by = ny2; }
      }
      if (bx === x && by === y) break;
      x = bx; y = by;
    }
    if (path.length > 6) {
      made++;
      for (const i of path) {
        used.add(i);
        tiles[i].river = true;
        if (tiles[i].t !== 'ocean' && tiles[i].t !== 'mountain') {
          tiles[i].fert = Math.min(1.4, tiles[i].fert + 0.35);
        }
        // enrich neighbors
        const px = i % W, py = Math.floor(i / W);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const j = (py + dy) * W + (px + dx);
          if (px + dx < 0 || py + dy < 0 || px + dx >= W || py + dy >= H) continue;
          const tt = tiles[j];
          if (tt.t !== 'ocean') tt.fert = Math.min(1.4, tt.fert + 0.12);
        }
      }
    }
  }

  // Occasionally an ancient, naturally-sacred place: a strange grove or standing stone.
  if (chance(r, 0.65)) {
    for (let tries = 0; tries < 60; tries++) {
      const x = ri(r, 6, W - 7), y = ri(r, 6, H - 7);
      const tl = tiles[y * W + x];
      if ((tl.t === 'forest' || tl.t === 'hills') && !tl.river) {
        tl.sacredId = 0; // placeholder; engine registers the site with a name
        break;
      }
    }
  }
}

export interface SitePick { x: number; y: number; score: number }

// Score a tile as a place to found a settlement.
export function scoreSite(st: SimState, x: number, y: number): number {
  const t = st.tiles[idx(st, x, y)];
  if (t.t === 'ocean' || t.t === 'mountain' || t.ruinName) return -1;
  let s = t.fert * 10;
  if (t.river) s += 5;
  let coastal = false, freshFert = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!inBounds(st, x + dx, y + dy)) continue;
    const n = st.tiles[idx(st, x + dx, y + dy)];
    if (n.t === 'ocean') coastal = true;
    if (n.river) s += 0.6;
    freshFert += n.fert;
    if (n.sacredId !== null) s += 3; // people gather near holy places
    if (n.ruinName) s -= 2;          // and avoid the bones of dead towns
  }
  s += freshFert * 0.35;
  if (coastal) s += 3;
  for (const o of st.settlements) {
    if (o.razed) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < 5) return -1;
    if (d < 10) s -= (10 - d) * 1.2;
  }
  return s;
}

export function findSettlementSite(st: SimState, nearX: number, nearY: number, minD: number, maxD: number): SitePick | null {
  let best: SitePick | null = null;
  for (let y = 2; y < st.H - 2; y++) {
    for (let x = 2; x < st.W - 2; x++) {
      const d = Math.hypot(x - nearX, y - nearY);
      if (d < minD || d > maxD) continue;
      const s = scoreSite(st, x, y);
      if (s > 0 && (!best || s > best.score)) best = { x, y, score: s };
    }
  }
  return best;
}
