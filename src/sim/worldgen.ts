import { RNG, rnd, ri, chance } from './rng';
import { SimState, Tile, idx, inBounds, dist } from './types';

// Hash-based value noise, deterministic from an integer seed.
function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 974634551);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Value noise that wraps in x with integer period p — seamless around the globe.
function vnoiseP(seed: number, x: number, y: number, p: number): number {
  let xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  xi = ((xi % p) + p) % p;
  const xj = (xi + 1) % p;
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xj, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xj, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

// fbm over a cylinder: x01 in [0,1) wraps, y in tile units.
function fbmC(seed: number, x01: number, y: number, oct: number, p0: number, yScale: number): number {
  let v = 0, amp = 0.5, p = p0, fy = yScale;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoiseP(seed + i * 7919, x01 * p, y * fy, p);
    amp *= 0.5;
    p *= 2;
    fy *= 2;
  }
  return v;
}

function quantile(values: Float32Array, q: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
}

// Count distinct landmasses (islands of >= minSize tiles).
function countIslands(st: SimState, minSize: number): number {
  const { W, H, tiles } = st;
  const seen = new Uint8Array(W * H);
  let islands = 0;
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || tiles[i].t === 'ocean') continue;
    // flood fill
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const jx = j % W, jy = Math.floor(j / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = ((jx + dx) % W + W) % W, ny = jy + dy;
        if (ny < 0 || ny >= H) continue;
        const k = ny * W + nx;
        if (!seen[k] && tiles[k].t !== 'ocean') { seen[k] = 1; stack.push(k); }
      }
    }
    if (size >= minSize) islands++;
  }
  return islands;
}

export function generateTerrain(st: SimState, r: RNG): void {
  const { W, H } = st;

  for (let attempt = 0; attempt < 6; attempt++) {
    const seedInt = Math.floor(rnd(r) * 2 ** 31);
    const moistSeed = seedInt + 104729;

    // raw elevation over the whole planet
    const elev = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat01 = (y + 0.5) / H;            // 0 north pole -> 1 south pole
      const polar = Math.pow(Math.sin(Math.PI * lat01), 0.55); // land thins toward the poles
      for (let x = 0; x < W; x++) {
        const x01 = (x + 0.5) / W;
        const e = fbmC(seedInt, x01, y, 4, 6, 0.09);
        const ridg = fbmC(seedInt + 555, x01, y, 3, 12, 0.16);
        elev[y * W + x] = (e * 0.75 + ridg * 0.35) * polar;
      }
    }
    // sea level chosen so ~26% of the world is land — always an archipelago, never a puddle
    const sea = quantile(elev, 0.74);
    const top = quantile(elev, 0.995);
    const span = Math.max(0.001, top - sea);

    const tiles: Tile[] = new Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat01 = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const en = (elev[i] - sea) / span; // <0 ocean, 0..1 land height
        const x01 = (x + 0.5) / W;
        const moistN = fbmC(moistSeed, x01, y, 3, 5, 0.07);
        const moist = Math.max(0, Math.min(1, moistN * 0.7 + Math.pow(Math.sin(Math.PI * lat01), 1.4) * 0.42 - 0.05));
        let t: Tile['t'];
        let fert = 0, forest = 0;
        const e01 = Math.max(0, Math.min(1, en));
        if (en < 0) {
          t = 'ocean';
        } else if (en < 0.055) {
          t = 'coast';
          fert = 0.45 + moist * 0.3;
        } else if (en > 0.62) {
          t = 'mountain';
          fert = 0.05;
        } else if (en > 0.42) {
          t = 'hills';
          fert = 0.25 + moist * 0.25;
          if (moist > 0.55) forest = (moist - 0.55) * 1.6;
        } else if (moist < 0.32) {
          t = 'dry';
          fert = 0.15 + moist * 0.3;
        } else if (moist > 0.56) {
          t = 'forest';
          fert = 0.55 + moist * 0.3;
          forest = 0.5 + (moist - 0.56) * 1.2;
        } else {
          t = 'plain';
          fert = 0.6 + moist * 0.45;
        }
        tiles[i] = {
          t,
          elev: en < 0 ? Math.max(0, 0.16 + en * 0.4) : 0.18 + e01 * 0.82,
          fert: Math.min(1.3, fert),
          forest: Math.min(1, forest),
          river: false,
          sacredId: null,
          ruinName: null,
        };
      }
    }
    st.tiles = tiles;

    const islands = countIslands(st, 14);
    if (islands >= 3 || attempt === 5) {
      carveRivers(st, r);
      markNaturalSacred(st, r);
      return;
    }
  }
}

function carveRivers(st: SimState, r: RNG): void {
  const { W, H, tiles } = st;
  const peaks: { x: number; y: number; e: number }[] = [];
  for (let y = 2; y < H - 2; y++) for (let x = 0; x < W; x++) {
    const e = tiles[y * W + x].elev;
    if (e > 0.62) peaks.push({ x, y, e });
  }
  peaks.sort((a, b) => b.e - a.e);
  const nRivers = ri(r, 5, 9);
  let made = 0;
  for (let p = 0; p < peaks.length && made < nRivers; p += 5) {
    const start = peaks[Math.min(peaks.length - 1, p + ri(r, 0, 4))];
    if (!start) break;
    let { x, y } = start;
    let steps = 0;
    const path: number[] = [];
    while (steps++ < 140) {
      const i = y * W + x;
      if (tiles[i].t === 'ocean') break;
      path.push(i);
      let bx = x, by = y, be = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx2 = ((x + dx) % W + W) % W, ny2 = y + dy;
        if (ny2 < 0 || ny2 >= H) continue;
        const j = ny2 * W + nx2;
        const e = tiles[j].elev + rnd(r) * 0.02;
        if (e < be && !path.includes(j)) { be = e; bx = nx2; by = ny2; }
      }
      if (bx === x && by === y) break;
      x = bx; y = by;
    }
    if (path.length > 5) {
      made++;
      for (const i of path) {
        tiles[i].river = true;
        if (tiles[i].t !== 'ocean' && tiles[i].t !== 'mountain') {
          tiles[i].fert = Math.min(1.4, tiles[i].fert + 0.35);
        }
        const px = i % W, py = Math.floor(i / W);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = ((px + dx) % W + W) % W, ny = py + dy;
          if (ny < 0 || ny >= H) continue;
          const tt = tiles[ny * W + nx];
          if (tt.t !== 'ocean') tt.fert = Math.min(1.4, tt.fert + 0.12);
        }
      }
    }
  }
}

function markNaturalSacred(st: SimState, r: RNG): void {
  const { W, H, tiles } = st;
  const n = ri(r, 1, 3);
  let placed = 0;
  for (let tries = 0; tries < 200 && placed < n; tries++) {
    const x = ri(r, 0, W - 1), y = ri(r, 6, H - 7);
    const tl = tiles[y * W + x];
    if ((tl.t === 'forest' || tl.t === 'hills' || tl.t === 'mountain') && !tl.river && tl.sacredId === null) {
      tl.sacredId = 0; // placeholder; engine registers the site with a name
      placed++;
    }
  }
}

export interface SitePick { x: number; y: number; score: number }

// Score a tile as a place to found a settlement.
export function scoreSite(st: SimState, x: number, y: number): number {
  const t = st.tiles[idx(st, x, y)];
  if (t.t === 'ocean' || t.t === 'mountain' || t.ruinName) return -1;
  if (y < 3 || y >= st.H - 3) return -1;
  let s = t.fert * 10;
  if (t.river) s += 5;
  let coastal = false, freshFert = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!inBounds(st, x, y + dy)) continue;
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
    const d = dist(o.x, o.y, x, y);
    if (d < 5) return -1;
    if (d < 10) s -= (10 - d) * 1.2;
  }
  return s;
}

export function findSettlementSite(st: SimState, nearX: number, nearY: number, minD: number, maxD: number): SitePick | null {
  let best: SitePick | null = null;
  for (let y = 3; y < st.H - 3; y++) {
    for (let x = 0; x < st.W; x++) {
      const d = dist(x, y, nearX, nearY);
      if (d < minD || d > maxD) continue;
      const s = scoreSite(st, x, y);
      if (s > 0 && (!best || s > best.score)) best = { x, y, score: s };
    }
  }
  return best;
}
