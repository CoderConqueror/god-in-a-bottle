import { useEffect, useRef } from 'react';
import { game, useGame } from '../state/store';
import { SimState, idx, Tile } from '../sim/types';
import { interventionById } from '../sim/interventions';

const SIZE = 960;

// ---- terrain palette --------------------------------------------------

function tileColor(t: Tile, x: number, y: number): string {
  const j = ((x * 7 + y * 13) % 10) / 10; // stable per-tile jitter
  switch (t.t) {
    case 'ocean': {
      const d = 30 + t.elev * 90 + j * 6;
      return `rgb(${10 + d * 0.14}, ${26 + d * 0.42}, ${44 + d * 0.62})`;
    }
    case 'coast': return `rgb(${196 + j * 12}, ${178 + j * 10}, ${132 + j * 8})`;
    case 'plain': {
      const g = t.fert;
      return `rgb(${128 - g * 42 + j * 10}, ${142 - g * 18 + j * 8}, ${86 - g * 22})`;
    }
    case 'forest': {
      const g = t.forest;
      return `rgb(${52 - g * 14 + j * 8}, ${92 - g * 20 + j * 6}, ${54 - g * 12})`;
    }
    case 'hills': return `rgb(${132 + j * 10}, ${118 + j * 8}, ${82 + j * 6})`;
    case 'mountain': {
      const snow = t.elev > 0.85;
      const b = 108 + t.elev * 70 + j * 8;
      return snow ? `rgb(${b + 60}, ${b + 62}, ${b + 70})` : `rgb(${b * 0.78}, ${b * 0.74}, ${b * 0.76})`;
    }
    case 'dry': return `rgb(${172 + j * 10}, ${146 + j * 8}, ${96 + j * 6})`;
  }
}

function drawTerrain(st: SimState, ctx: CanvasRenderingContext2D): void {
  const px = SIZE / st.W;
  ctx.clearRect(0, 0, SIZE, SIZE);
  // abyss under everything
  const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.55);
  bg.addColorStop(0, '#0e2438');
  bg.addColorStop(1, '#071322');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const t = st.tiles[idx(st, x, y)];
      ctx.fillStyle = tileColor(t, x, y);
      ctx.fillRect(x * px - 0.3, y * px - 0.3, px + 0.6, px + 0.6);
    }
  }
  // soft elevation shading pass
  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const t = st.tiles[idx(st, x, y)];
      if (t.t === 'ocean') continue;
      const west = x > 0 ? st.tiles[idx(st, x - 1, y)].elev : t.elev;
      const dh = t.elev - west;
      if (Math.abs(dh) > 0.015) {
        ctx.fillStyle = dh > 0 ? `rgba(255,240,200,${Math.min(0.18, dh * 1.6)})` : `rgba(10,16,30,${Math.min(0.22, -dh * 1.8)})`;
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
  }
  // rivers
  ctx.strokeStyle = 'rgba(96,164,205,0.9)';
  ctx.lineWidth = px * 0.32;
  ctx.lineCap = 'round';
  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const t = st.tiles[idx(st, x, y)];
      if (!t.river || t.t === 'ocean') continue;
      // connect to a neighboring river/ocean tile downstream-ish
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= st.W || ny >= st.H) continue;
        const n = st.tiles[idx(st, nx, ny)];
        if (n.river || n.t === 'ocean') {
          ctx.beginPath();
          ctx.moveTo((x + 0.5) * px, (y + 0.5) * px);
          ctx.lineTo((nx + 0.5) * px, (ny + 0.5) * px);
          ctx.stroke();
          break;
        }
      }
    }
  }
  // trees: stable stipple from tile coords
  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const t = st.tiles[idx(st, x, y)];
      if (t.forest < 0.2) continue;
      const n = Math.round(t.forest * 3);
      for (let k = 0; k < n; k++) {
        const hx = ((x * 31 + y * 17 + k * 47) % 100) / 100;
        const hy = ((x * 13 + y * 41 + k * 71) % 100) / 100;
        const tx = (x + 0.15 + hx * 0.7) * px;
        const ty = (y + 0.15 + hy * 0.7) * px;
        ctx.fillStyle = 'rgba(22,52,30,0.85)';
        ctx.beginPath();
        ctx.moveTo(tx, ty - px * 0.28);
        ctx.lineTo(tx - px * 0.14, ty + px * 0.1);
        ctx.lineTo(tx + px * 0.14, ty + px * 0.1);
        ctx.fill();
      }
    }
  }
  // ruins
  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const t = st.tiles[idx(st, x, y)];
      if (!t.ruinName) continue;
      const cx = (x + 0.5) * px, cy = (y + 0.5) * px;
      ctx.fillStyle = 'rgba(30,30,34,0.8)';
      ctx.fillRect(cx - px * 0.5, cy - px * 0.2, px, px * 0.5);
      ctx.strokeStyle = 'rgba(150,145,140,0.75)';
      ctx.lineWidth = 1.4;
      for (const [ox, oy, h] of [[-0.32, 0.1, 0.5], [-0.05, 0.05, 0.7], [0.25, 0.12, 0.4]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + ox * px, cy + oy * px);
        ctx.lineTo(cx + ox * px, cy + (oy - h) * px);
        ctx.stroke();
      }
    }
  }
  // vignette
  const vg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.32, SIZE / 2, SIZE / 2, SIZE * 0.52);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,6,14,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

// ---- dynamic layer ------------------------------------------------------

interface Cloud { x: number; y: number; r: number; s: number; a: number }
const clouds: Cloud[] = Array.from({ length: 6 }, (_, i) => ({
  x: (i * 197) % SIZE,
  y: 80 + ((i * 331) % (SIZE - 200)),
  r: 60 + (i * 53) % 70,
  s: 2.5 + (i % 3) * 1.6,
  a: 0.05 + (i % 3) * 0.02,
}));

function drawDynamic(st: SimState, ctx: CanvasRenderingContext2D, time: number, hover: { x: number; y: number } | null): void {
  const px = SIZE / st.W;
  ctx.clearRect(0, 0, SIZE, SIZE);

  // water glints
  ctx.fillStyle = 'rgba(160,220,255,0.25)';
  for (let i = 0; i < 40; i++) {
    const gx = (i * 173.3 + time * 12) % SIZE;
    const gy = (i * 311.7) % SIZE;
    const tx = Math.floor(gx / px), ty = Math.floor(gy / px);
    if (tx >= 0 && ty >= 0 && tx < st.W && ty < st.H && st.tiles[idx(st, tx, ty)].t === 'ocean') {
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + i * 1.7);
      ctx.globalAlpha = 0.18 * tw;
      ctx.fillRect(gx, gy, 3, 1.4);
    }
  }
  ctx.globalAlpha = 1;

  // sacred sites shimmer
  for (const site of st.sacred) {
    const cx = (site.x + 0.5) * px, cy = (site.y + 0.5) * px;
    const pulse = 0.6 + 0.4 * Math.sin(time * 1.8 + site.id);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, px * 2.6);
    g.addColorStop(0, `rgba(140,235,255,${0.28 * pulse})`);
    g.addColorStop(1, 'rgba(140,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, px * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(200,245,255,${0.5 + 0.3 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - px * 0.55);
    ctx.lineTo(cx, cy + px * 0.3);
    ctx.moveTo(cx - px * 0.3, cy + px * 0.3);
    ctx.lineTo(cx + px * 0.3, cy + px * 0.3);
    ctx.stroke();
  }

  // settlements
  for (const s of st.settlements) {
    if (s.razed) continue;
    const cx = (s.x + 0.5) * px, cy = (s.y + 0.5) * px;
    const n = Math.max(2, Math.min(11, Math.round(Math.sqrt(s.pop) * 1.15)));
    const selected = game.selection.kind === 'settlement' && game.selection.sid === s.id;
    // hearth glow
    const glowR = px * (1.6 + n * 0.28);
    const warm = s.plague > 0 ? 'rgba(170,220,120,' : s.cursed > 0 ? 'rgba(150,110,220,' : 'rgba(255,190,90,';
    const flicker = 0.75 + 0.25 * Math.sin(time * 3 + s.id * 2.1);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    g.addColorStop(0, `${warm}${0.34 * flicker})`);
    g.addColorStop(1, `${warm}0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
    // houses
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + s.id;
      const rr = k === 0 ? 0 : px * (0.45 + (k % 3) * 0.34);
      const hx = cx + Math.cos(ang) * rr;
      const hy = cy + Math.sin(ang) * rr;
      const hs = px * (k === 0 ? 0.5 : 0.36);
      ctx.fillStyle = '#3a2c22';
      ctx.fillRect(hx - hs / 2, hy - hs * 0.3, hs, hs * 0.55);
      ctx.fillStyle = s.buildings.temple ? '#d8c290' : '#7a5c40';
      ctx.beginPath();
      ctx.moveTo(hx - hs * 0.62, hy - hs * 0.28);
      ctx.lineTo(hx, hy - hs * 0.75);
      ctx.lineTo(hx + hs * 0.62, hy - hs * 0.28);
      ctx.fill();
    }
    // temple spark
    if (s.buildings.temple) {
      ctx.fillStyle = `rgba(255,235,170,${0.7 + 0.3 * Math.sin(time * 2.4 + s.id)})`;
      ctx.beginPath();
      ctx.arc(cx, cy - px * 1.1, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // war marker
    if (s.warWith !== null) {
      ctx.fillStyle = `rgba(255,90,60,${0.5 + 0.5 * Math.sin(time * 5)})`;
      ctx.font = `${px * 1.1}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('⚔', cx + px * 1.4, cy - px * 0.8);
    }
    // label
    ctx.font = `600 ${Math.max(12, px * 0.85)}px Iowan Old Style, Palatino, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6,10,18,0.65)';
    ctx.fillText(s.name, cx + 1, cy + px * 2.2 + 1);
    ctx.fillStyle = selected ? '#ffe9b0' : 'rgba(238,228,200,0.92)';
    ctx.fillText(s.name, cx, cy + px * 2.2);
    if (selected) {
      ctx.strokeStyle = `rgba(255,225,150,${0.65 + 0.3 * Math.sin(time * 3)})`;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, px * 2.6, time * 0.5, time * 0.5 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // clouds
  for (const c of clouds) {
    const cx = (c.x + time * c.s) % (SIZE + 300) - 150;
    ctx.fillStyle = `rgba(225,235,245,${c.a + (st.weather.rain > 0.4 ? 0.06 : 0)})`;
    for (const [ox, oy, rr] of [[0, 0, 1], [c.r * 0.6, 10, 0.75], [-c.r * 0.55, 8, 0.7]] as const) {
      ctx.beginPath();
      ctx.ellipse(cx + ox, c.y + oy, c.r * rr, c.r * rr * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // rain
  if (st.weather.rain > 0.15) {
    const a = Math.min(0.5, st.weather.rain * 0.22);
    ctx.strokeStyle = `rgba(170,210,255,${a})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const rx = (i * 127.7 + time * 340) % SIZE;
      const ry = (i * 211.3 + time * 560) % SIZE;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 3, ry + 11);
    }
    ctx.stroke();
  }
  // drought tint
  if (st.weather.drought > 0.15) {
    ctx.fillStyle = `rgba(210,160,70,${Math.min(0.2, st.weather.drought * 0.09)})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  // eclipse
  if (st.weather.eclipse > 0) {
    ctx.fillStyle = 'rgba(4,4,14,0.62)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const ex = SIZE * 0.5, ey = SIZE * 0.3;
    const g2 = ctx.createRadialGradient(ex, ey, 26, ex, ey, 80);
    g2.addColorStop(0, 'rgba(255,250,230,0.95)');
    g2.addColorStop(0.35, 'rgba(255,240,200,0.25)');
    g2.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(ex, ey, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05050e';
    ctx.beginPath();
    ctx.arc(ex, ey, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  // comet
  if (st.weather.comet > 0) {
    const t2 = (time * 0.07) % 1.4;
    const cx2 = SIZE * (0.05 + t2 * 0.7), cy2 = SIZE * (0.12 + t2 * 0.16);
    const grad = ctx.createLinearGradient(cx2 - 190, cy2 - 60, cx2, cy2);
    grad.addColorStop(0, 'rgba(150,200,255,0)');
    grad.addColorStop(1, 'rgba(220,240,255,0.85)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx2 - 190, cy2 - 60);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,250,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx2, cy2, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // targeting reticle / hover
  if (hover) {
    const def = game.targeting ? interventionById(game.targeting) : null;
    if (def) {
      const cx = (hover.x + 0.5) * px, cy = (hover.y + 0.5) * px;
      ctx.strokeStyle = `rgba(255,225,150,${0.7 + 0.3 * Math.sin(time * 6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, px * 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - px * 3, cy); ctx.lineTo(cx - px * 1.4, cy);
      ctx.moveTo(cx + px * 1.4, cy); ctx.lineTo(cx + px * 3, cy);
      ctx.moveTo(cx, cy - px * 3); ctx.lineTo(cx, cy - px * 1.4);
      ctx.moveTo(cx, cy + px * 1.4); ctx.lineTo(cx, cy + px * 3);
      ctx.stroke();
    }
  }
}

// ---- component -------------------------------------------------------------

export function BottleView(): JSX.Element {
  useGame(); // re-render on state bumps (keeps selection/cursor in sync)
  const terrainRef = useRef<HTMLCanvasElement>(null);
  const dynRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const cacheKey = useRef('');

  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const st = game.st;
      const tc = terrainRef.current, dc = dynRef.current;
      if (tc && dc) {
        const key = `${st.seed}:${st.terrainV}`;
        if (cacheKey.current !== key) {
          const ctx = tc.getContext('2d')!;
          drawTerrain(st, ctx);
          cacheKey.current = key;
        }
        const ctx2 = dc.getContext('2d')!;
        drawDynamic(st, ctx2, t / 1000, hoverRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toTile = (e: React.MouseEvent): { x: number; y: number } => {
    const el = dynRef.current!;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * game.st.W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * game.st.H);
    return { x: Math.max(0, Math.min(game.st.W - 1, x)), y: Math.max(0, Math.min(game.st.H - 1, y)) };
  };

  return (
    <div className={`bottle-stage ${game.targeting ? 'targeting' : ''}`}>
      <svg className="bottle-neck" viewBox="0 0 200 150" aria-hidden>
        <defs>
          <linearGradient id="corkG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c9a06a" />
            <stop offset="1" stopColor="#8a6438" />
          </linearGradient>
          <linearGradient id="neckG" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgba(180,210,235,0.28)" />
            <stop offset="0.5" stopColor="rgba(180,210,235,0.06)" />
            <stop offset="1" stopColor="rgba(180,210,235,0.28)" />
          </linearGradient>
        </defs>
        <rect x="82" y="4" width="36" height="30" rx="6" fill="url(#corkG)" />
        <rect x="84" y="9" width="32" height="3" rx="1.5" fill="rgba(60,40,20,0.35)" />
        <path d="M78 34 L78 92 Q78 112 58 126 L142 126 Q122 112 122 92 L122 34 Z" fill="url(#neckG)" stroke="rgba(200,225,245,0.5)" strokeWidth="2" />
        <rect x="72" y="30" width="56" height="8" rx="4" fill="rgba(200,225,245,0.35)" stroke="rgba(210,235,250,0.5)" strokeWidth="1.5" />
      </svg>
      <div className="bottle-bulb">
        <canvas ref={terrainRef} width={SIZE} height={SIZE} className="layer" />
        <canvas
          ref={dynRef}
          width={SIZE}
          height={SIZE}
          className="layer top"
          onMouseMove={e => { hoverRef.current = toTile(e); }}
          onMouseLeave={() => { hoverRef.current = null; }}
          onClick={e => { const p = toTile(e); game.clickWorld(p.x, p.y); }}
        />
        <div className="glass-shine" aria-hidden />
        <div className="glass-rim" aria-hidden />
      </div>
      <div className="bottle-base" aria-hidden />
      {game.targeting && (
        <div className="targeting-hint">
          {interventionById(game.targeting)?.target === 'tile' ? 'Choose ground to hallow' : 'Choose a settlement'} — <button className="linkish" onClick={() => game.cancelTargeting()}>or withhold your hand</button>
        </div>
      )}
    </div>
  );
}
