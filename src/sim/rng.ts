// Deterministic seeded RNG (cyrb128 hash -> sfc32). State is a plain object so it serializes into saves.
export interface RNG { a: number; b: number; c: number; d: number }

export function seedRng(seed: string): RNG {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return { a: (h1 ^ h2 ^ h3 ^ h4) >>> 0, b: h1 >>> 0, c: h2 >>> 0, d: h3 >>> 0 };
}

export function rnd(r: RNG): number {
  r.a >>>= 0; r.b >>>= 0; r.c >>>= 0; r.d >>>= 0;
  let t = (r.a + r.b) | 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) | 0;
  r.c = ((r.c << 21) | (r.c >>> 11)) | 0;
  r.d = (r.d + 1) | 0;
  t = (t + r.d) | 0;
  r.c = (r.c + t) | 0;
  return (t >>> 0) / 4294967296;
}

export function ri(r: RNG, min: number, max: number): number {
  return min + Math.floor(rnd(r) * (max - min + 1));
}

export function pick<T>(r: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rnd(r) * arr.length)];
}

export function chance(r: RNG, p: number): boolean {
  return rnd(r) < p;
}

export function shuffled<T>(r: RNG, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(r) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomSeedString(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
