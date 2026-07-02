// Paints the living surface of the planet from simulation state.
// Base geography changes rarely; development (roads, fields, scars, ruins)
// accumulates — history must leave marks you can see from orbit.
import { SimState, Tile, idx, dist } from '../sim/types';

export const TEX_W = 2048;
export const TEX_H = 1024;

const SX = TEX_W / 128; // pixels per tile (grid is 128x64)
const SY = TEX_H / 64;

function tileRGB(t: Tile, x: number, y: number, H: number): [number, number, number] {
  const j = ((x * 7 + y * 13) % 10) / 10;
  const lat = Math.abs((y + 0.5) / H - 0.5) * 2; // 0 equator -> 1 pole
  const ice = Math.max(0, (lat - 0.78) / 0.22);  // polar whitening
  let r: number, g: number, b: number;
  switch (t.t) {
    case 'ocean': {
      const d = 26 + t.elev * 260 + j * 8;
      r = 8 + d * 0.16; g = 24 + d * 0.42; b = 46 + d * 0.62;
      break;
    }
    case 'coast': r = 189 + j * 12; g = 172 + j * 10; b = 128 + j * 8; break;
    case 'plain': {
      const f = t.fert;
      r = 118 - f * 40 + j * 10; g = 138 - f * 14 + j * 8; b = 74 - f * 18;
      break;
    }
    case 'forest': {
      const f = t.forest;
      r = 46 - f * 12 + j * 8; g = 88 - f * 22 + j * 6; b = 48 - f * 12;
      break;
    }
    case 'hills': r = 128 + j * 10; g = 114 + j * 8; b = 80 + j * 6; break;
    case 'mountain': {
      const bb = 104 + t.elev * 74 + j * 8;
      if (t.elev > 0.82) { r = bb + 62; g = bb + 64; b = bb + 74; }
      else { r = bb * 0.76; g = bb * 0.72; b = bb * 0.74; }
      break;
    }
    case 'dry': r = 168 + j * 10; g = 142 + j * 8; b = 94 + j * 6; break;
  }
  if (ice > 0) {
    const w = ice * (t.t === 'ocean' ? 0.85 : 0.9);
    r = r + (222 - r) * w; g = g + (232 - g) * w; b = b + (240 - b) * w;
  }
  return [r, g, b];
}

function px(x: number, y: number): [number, number] {
  return [(x + 0.5) * SX, (y + 0.5) * SY];
}

// draw a line on the wrapping cylinder (split at the seam if needed)
function wrapLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  if (Math.abs(x1 - x2) > TEX_W / 2) {
    const [lo, hi] = x1 < x2 ? [[x1, y1], [x2, y2]] : [[x2, y2], [x1, y1]];
    ctx.beginPath();
    ctx.moveTo(lo[0], lo[1]); ctx.lineTo(hi[0] - TEX_W, hi[1]);
    ctx.moveTo(hi[0], hi[1]); ctx.lineTo(lo[0] + TEX_W, lo[1]);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

export function paintWorld(st: SimState, canvas: HTMLCanvasElement): void {
  const { W, H } = st;
  const ctx = canvas.getContext('2d')!;

  // --- 1. base colors at tile resolution, upscaled with smoothing ---------
  const small = document.createElement('canvas');
  small.width = W; small.height = H;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = tileRGB(st.tiles[y * W + x], x, y, H);
    const o = (y * W + x) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.drawImage(small, 0, 0, TEX_W, TEX_H);

  // --- 2. relief: light from the west, shade to the east ------------------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = st.tiles[y * W + x];
    if (t.t === 'ocean') continue;
    const west = st.tiles[y * W + ((x - 1 + W) % W)];
    const dh = t.elev - west.elev;
    if (Math.abs(dh) > 0.02) {
      ctx.fillStyle = dh > 0 ? `rgba(255,240,205,${Math.min(0.20, dh * 1.2)})` : `rgba(8,12,26,${Math.min(0.26, -dh * 1.4)})`;
      ctx.fillRect(x * SX, y * SY, SX, SY);
    }
  }

  // --- 3. rivers -----------------------------------------------------------
  ctx.strokeStyle = 'rgba(94,166,208,0.92)';
  ctx.lineWidth = SX * 0.28;
  ctx.lineCap = 'round';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = st.tiles[y * W + x];
    if (!t.river || t.t === 'ocean') continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
      const nx = (x + dx + W) % W, ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const n = st.tiles[ny * W + nx];
      if (n.river || n.t === 'ocean') {
        const [x1, y1] = px(x, y); const [x2, y2] = px(x + dx, ny);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        break;
      }
    }
  }

  // --- 4. forest stipple ----------------------------------------------------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = st.tiles[y * W + x];
    if (t.forest < 0.18) continue;
    const n = Math.round(t.forest * 4);
    for (let k = 0; k < n; k++) {
      const hx = ((x * 31 + y * 17 + k * 47) % 100) / 100;
      const hy = ((x * 13 + y * 41 + k * 71) % 100) / 100;
      ctx.fillStyle = k % 2 ? 'rgba(20,48,28,0.8)' : 'rgba(34,66,38,0.7)';
      ctx.beginPath();
      ctx.arc((x + 0.12 + hx * 0.76) * SX, (y + 0.12 + hy * 0.76) * SY, SX * 0.1 + t.forest * SX * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- 5. scars: burned and abandoned ground stains the world --------------
  for (const sc of st.scars) {
    const [cx, cy] = px(sc.x, sc.y);
    const R = sc.r * SX;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    if (sc.kind === 'burn') {
      g.addColorStop(0, 'rgba(30,20,16,0.55)');
      g.addColorStop(0.6, 'rgba(48,32,22,0.28)');
      g.addColorStop(1, 'rgba(48,32,22,0)');
    } else {
      g.addColorStop(0, 'rgba(70,68,58,0.4)');
      g.addColorStop(1, 'rgba(70,68,58,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  }

  // --- 6. farmland & town footprints ---------------------------------------
  for (const s of st.settlements) {
    if (s.razed) continue;
    const [cx, cy] = px(s.x, s.y);
    const fieldR = SX * (0.9 + Math.sqrt(Math.max(1, s.pop)) * 0.32);
    // field patchwork: radial strips of worked earth
    const strips = Math.min(14, 4 + Math.floor(s.pop / 8));
    for (let k = 0; k < strips; k++) {
      const ang = (k / strips) * Math.PI * 2 + s.id * 0.7;
      const rr = fieldR * (0.55 + ((k * 37) % 40) / 90);
      const fx = cx + Math.cos(ang) * rr;
      const fy = cy + Math.sin(ang) * rr * 0.7;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(ang);
      ctx.fillStyle = k % 3 === 0 ? 'rgba(196,178,96,0.34)' : k % 3 === 1 ? 'rgba(150,158,84,0.3)' : 'rgba(172,150,92,0.26)';
      ctx.fillRect(-SX * 0.5, -SY * 0.3, SX * 1.0, SY * 0.55);
      ctx.restore();
    }
    // trodden earth at the center
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, SX * 0.9);
    g.addColorStop(0, 'rgba(96,78,56,0.5)');
    g.addColorStop(1, 'rgba(96,78,56,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, SX * 0.9, 0, Math.PI * 2); ctx.fill();
    // houses: tiny warm-roofed dots
    const n = Math.max(3, Math.min(24, Math.round(Math.sqrt(s.pop) * 2)));
    for (let k = 0; k < n; k++) {
      const ang = (k * 2.4) + s.id;
      const rr = SX * 0.18 * Math.sqrt(k + 1);
      const hx = cx + Math.cos(ang) * rr;
      const hy = cy + Math.sin(ang) * rr * 0.8;
      ctx.fillStyle = 'rgba(52,38,26,0.95)';
      ctx.fillRect(hx - 1.6, hy - 1.2, 3.2, 2.4);
      ctx.fillStyle = s.buildings.temple ? 'rgba(226,200,140,0.9)' : 'rgba(140,100,64,0.9)';
      ctx.fillRect(hx - 1.6, hy - 2.2, 3.2, 1.1);
    }
    // walls: a pale ring
    if (s.buildings.walls) {
      ctx.strokeStyle = 'rgba(200,196,180,0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, SX * 1.15, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // --- 7. roads & sea lanes --------------------------------------------------
  for (const rd of st.roads) {
    const a = st.settlements.find(s => s.id === rd.a);
    const b = st.settlements.find(s => s.id === rd.b);
    if (!a || !b) continue;
    const [x1, y1] = px(a.x, a.y);
    const [x2, y2] = px(b.x, b.y);
    const sea = dist(a.x, a.y, b.x, b.y) > 18;
    const dead = a.razed || b.razed;
    ctx.setLineDash(sea ? [3, 9] : [7, 5]);
    ctx.strokeStyle = dead ? 'rgba(150,140,120,0.18)' : sea ? 'rgba(150,210,230,0.4)' : 'rgba(214,192,150,0.5)';
    ctx.lineWidth = 1.8;
    wrapLine(ctx, x1, y1, x2, y2);
    ctx.setLineDash([]);
  }

  // --- 8. pilgrimage routes ---------------------------------------------------
  for (const site of st.sacred) {
    const [sx, sy] = px(site.x, site.y);
    for (const s of st.settlements) {
      if (s.razed || s.patron === null) continue;
      if (site.deityId !== null && site.deityId !== s.patron) continue;
      if (dist(s.x, s.y, site.x, site.y) > 20) continue;
      const [x1, y1] = px(s.x, s.y);
      ctx.setLineDash([1.5, 7]);
      ctx.strokeStyle = 'rgba(140,235,255,0.35)';
      ctx.lineWidth = 1.4;
      wrapLine(ctx, x1, y1, sx, sy);
      ctx.setLineDash([]);
    }
    // hallowed ground glows faintly forever
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, SX * 2.2);
    g.addColorStop(0, 'rgba(140,235,255,0.4)');
    g.addColorStop(1, 'rgba(140,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, SX * 2.2, 0, Math.PI * 2); ctx.fill();
  }

  // --- 9. ruins: broken geometry the grass is eating -------------------------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = st.tiles[y * W + x];
    if (!t.ruinName) continue;
    const [cx, cy] = px(x, y);
    ctx.strokeStyle = 'rgba(168,160,150,0.85)';
    ctx.lineWidth = 1.4;
    for (const [ox, oy, h] of [[-0.3, 0.12, 0.42], [-0.05, 0.06, 0.6], [0.22, 0.14, 0.34]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + ox * SX, cy + oy * SY);
      ctx.lineTo(cx + ox * SX, cy + (oy - h) * SY);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,116,108,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy + SY * 0.1, SX * 0.5, 0.2, Math.PI - 0.4); ctx.stroke();
  }

  // --- 10. drought browning (temporary, painted because it repaints often) ---
  if (st.weather.drought > 0.2) {
    ctx.fillStyle = `rgba(196,150,70,${Math.min(0.16, st.weather.drought * 0.07)})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
  }
}

// Grayscale elevation for the bump map — gives mountains real shadowed relief.
export function paintBump(st: SimState, canvas: HTMLCanvasElement): void {
  const { W, H } = st;
  const small = document.createElement('canvas');
  small.width = W; small.height = H;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const t = st.tiles[i];
    const v = t.t === 'ocean' ? 20 : 40 + t.elev * 215;
    const o = i * 4;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

// Ocean shines, land does not.
export function paintSpec(st: SimState, canvas: HTMLCanvasElement): void {
  const { W, H } = st;
  const small = document.createElement('canvas');
  small.width = W; small.height = H;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = st.tiles[i].t === 'ocean' ? 210 : 18;
    const o = i * 4;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

// Wispy procedural clouds (purely visual — Math.random is fine here).
export function paintClouds(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const W2 = canvas.width, H2 = canvas.height;
  ctx.clearRect(0, 0, W2, H2);
  for (let i = 0; i < 130; i++) {
    const band = Math.random();
    const y = H2 * (0.12 + band * 0.76);
    const x = Math.random() * W2;
    const w = 26 + Math.random() * 120;
    const h = 7 + Math.random() * 18;
    const a = 0.05 + Math.random() * 0.1;
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, `rgba(235,240,248,${a})`);
    g.addColorStop(1, 'rgba(235,240,248,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / w);
    ctx.beginPath(); ctx.arc(0, 0, w, 0, Math.PI * 2); ctx.fill();
    // wrap seam copies
    ctx.restore();
    if (x < w) {
      ctx.save(); ctx.translate(x + W2, y); ctx.scale(1, h / w);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
}
