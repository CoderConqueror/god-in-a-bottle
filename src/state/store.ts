import { useSyncExternalStore } from 'react';
import { SimState } from '../sim/types';
import { newSim, simTick, SAVE_VERSION } from '../sim/engine';
import { applyIntervention, interventionById } from '../sim/interventions';
import { randomSeedString } from '../sim/rng';
import { ambience } from '../audio';

export interface Selection {
  kind: 'none' | 'settlement' | 'tile';
  sid?: number;
  x?: number;
  y?: number;
}

export interface SaveMeta { name: string; year: number; savedAt: number; seed: string }

export const SPEEDS = [
  { label: '1×', tps: 1 },
  { label: '2×', tps: 3 },
  { label: '4×', tps: 8 },
  { label: '12×', tps: 24 },
];

const SLOT_KEY = (n: number) => `giab:v${SAVE_VERSION}:slot:${n}`;

class Game {
  st: SimState;
  running = false;
  speedIdx = 1;
  targeting: string | null = null; // intervention id awaiting a target
  selection: Selection = { kind: 'none' };
  toastMsg: { text: string; id: number } | null = null;
  showOnboarding = false;
  showSummary = false;
  modal: 'none' | 'saves' | 'seed' = 'none';
  muted = true;
  leftTab: 'chronicle' | 'myths' | 'charts' = 'chronicle';
  focusEventId: number | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private acc = 0;
  private lastTime = 0;
  private lastEventCount = 0;
  private toastSeq = 1;

  constructor() {
    const auto = this.readSlot(0);
    if (auto) {
      this.st = auto;
    } else {
      this.st = newSim(randomSeedString());
      this.showOnboarding = true;
    }
    if (!localStorage.getItem('giab:seen')) this.showOnboarding = true;
    if (this.st.ended) this.showSummary = true;
    this.lastEventCount = this.st.events.length;
  }

  // ---- subscription ------------------------------------------------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = (): number => this.version;
  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- loop ---------------------------------------------------------
  play(): void {
    if (this.st.ended) return;
    this.running = true;
    if (this.timer === null) {
      this.lastTime = performance.now();
      this.timer = window.setInterval(() => this.pump(), 66);
    }
    this.bump();
  }
  pause(): void {
    this.running = false;
    this.bump();
  }
  toggle(): void { this.running ? this.pause() : this.play(); }
  setSpeed(i: number): void {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.bump();
  }

  private pump(): void {
    if (!this.running || this.st.ended) return;
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.acc += dt * SPEEDS[this.speedIdx].tps;
    let steps = 0;
    while (this.acc >= 1 && steps < 30) {
      this.acc -= 1;
      steps++;
      simTick(this.st);
    }
    if (steps > 0) {
      this.afterTicks();
      this.bump();
    }
  }

  stepYear(): void {
    if (this.st.ended) return;
    for (let i = 0; i < 4; i++) simTick(this.st);
    this.afterTicks();
    this.bump();
  }

  private afterTicks(): void {
    // sound cues for fresh important events
    const evs = this.st.events;
    for (let i = this.lastEventCount; i < evs.length; i++) {
      if (evs[i].imp === 3) ambience.event(evs[i].type === 'era' ? 'era' : evs[i].type);
    }
    this.lastEventCount = evs.length;
    // autosave every two in-game years
    if (this.st.tick % 8 === 0) this.writeSlot(0, 'Autosave');
    if (this.st.ended) {
      this.running = false;
      this.showSummary = true;
      this.writeSlot(0, 'Autosave');
      ambience.event('era');
    }
  }

  // ---- worlds --------------------------------------------------------
  newWorld(seed?: string): void {
    this.st = newSim(seed && seed.trim() ? seed.trim() : randomSeedString());
    this.selection = { kind: 'none' };
    this.targeting = null;
    this.showSummary = false;
    this.running = false;
    this.lastEventCount = this.st.events.length;
    this.acc = 0;
    this.writeSlot(0, 'Autosave');
    this.toast(`A new world: ${this.st.worldName} (seed ${this.st.seed})`);
    this.bump();
  }
  restart(): void {
    const seed = this.st.seed;
    this.newWorld(seed);
    this.toast(`The bottle is turned back. Seed ${seed} begins again.`);
  }

  // ---- interventions ---------------------------------------------------
  beginIntervention(id: string): void {
    const def = interventionById(id);
    if (!def) return;
    if (this.st.influence < def.cost) { this.toast('Not enough influence.'); return; }
    if ((this.st.cooldowns[id] ?? 0) > this.st.tick) { this.toast('That power is still spent.'); return; }
    if (def.target === 'global') {
      this.finishIntervention(id, undefined);
    } else {
      this.targeting = this.targeting === id ? null : id;
      ambience.event('ui');
      this.bump();
    }
  }
  finishIntervention(id: string, target?: { sid?: number; x?: number; y?: number }): void {
    const res = applyIntervention(this.st, id, target);
    this.targeting = null;
    this.toast(res.msg);
    if (res.ok) {
      const def = interventionById(id)!;
      ambience.event(['plague', 'curse', 'drought'].includes(id) ? 'plague' : 'divine');
      if (id === 'rain') ambience.event('rain');
      this.afterTicks();
    }
    this.bump();
  }
  cancelTargeting(): void {
    if (this.targeting) { this.targeting = null; this.bump(); }
  }

  // ---- selection --------------------------------------------------------
  select(sel: Selection): void {
    this.selection = sel;
    this.bump();
  }
  clickWorld(x: number, y: number): void {
    // if targeting, resolve the intervention
    if (this.targeting) {
      const def = interventionById(this.targeting)!;
      if (def.target === 'tile') {
        this.finishIntervention(this.targeting, { x, y });
        return;
      }
      if (def.target === 'settlement') {
        const s = this.nearestSettlement(x, y, 3.5);
        if (s) { this.finishIntervention(this.targeting, { sid: s.id }); return; }
        this.toast('Choose a settlement.');
        return;
      }
    }
    const s = this.nearestSettlement(x, y, 3);
    if (s) this.select({ kind: 'settlement', sid: s.id });
    else this.select({ kind: 'tile', x, y });
  }
  private nearestSettlement(x: number, y: number, maxD: number) {
    let best = null as null | { id: number; d: number };
    for (const s of this.st.settlements) {
      if (s.razed) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= maxD && (!best || d < best.d)) best = { id: s.id, d };
    }
    return best ? this.st.settlements.find(s => s.id === best!.id)! : null;
  }

  // ---- saves --------------------------------------------------------------
  private readSlot(n: number): SimState | null {
    try {
      const raw = localStorage.getItem(SLOT_KEY(n));
      if (!raw) return null;
      const data = JSON.parse(raw);
      return this.validateSave(data);
    } catch {
      return null;
    }
  }
  private validateSave(data: unknown): SimState | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as { version?: number; state?: SimState };
    if (d.version !== SAVE_VERSION || !d.state) return null;
    const s = d.state;
    if (typeof s.seed !== 'string' || !Array.isArray(s.tiles) || !Array.isArray(s.people) || !s.rng) return null;
    return s;
  }
  slotMeta(n: number): SaveMeta | null {
    try {
      const raw = localStorage.getItem(SLOT_KEY(n));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.version !== SAVE_VERSION || !d.state) return null;
      return { name: d.name ?? `Slot ${n}`, year: Math.floor(d.state.tick / 4) + 1, savedAt: d.savedAt ?? 0, seed: d.state.seed };
    } catch {
      return null;
    }
  }
  writeSlot(n: number, name: string): boolean {
    try {
      localStorage.setItem(SLOT_KEY(n), JSON.stringify({
        version: SAVE_VERSION,
        name,
        savedAt: Date.now(),
        state: this.st,
      }));
      return true;
    } catch {
      this.toast('Could not save (storage full?).');
      return false;
    }
  }
  saveTo(n: number): void {
    if (this.writeSlot(n, `${this.st.worldName}, Year ${Math.floor(this.st.tick / 4) + 1}`)) {
      this.toast(`Saved to slot ${n}.`);
      this.bump();
    }
  }
  loadFrom(n: number): void {
    const s = this.readSlot(n);
    if (!s) { this.toast('That slot is empty or from another age of the code.'); return; }
    this.st = s;
    this.running = false;
    this.showSummary = s.ended;
    this.selection = { kind: 'none' };
    this.targeting = null;
    this.lastEventCount = s.events.length;
    this.toast(`${s.worldName} returns, in year ${Math.floor(s.tick / 4) + 1}.`);
    this.bump();
  }
  deleteSlot(n: number): void {
    localStorage.removeItem(SLOT_KEY(n));
    this.bump();
  }
  exportSave(): void {
    const blob = new Blob([JSON.stringify({
      version: SAVE_VERSION,
      name: `${this.st.worldName} export`,
      savedAt: Date.now(),
      state: this.st,
    })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `god-in-a-bottle-${this.st.seed}-y${Math.floor(this.st.tick / 4) + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('World exported as JSON.');
  }
  importSave(file: File): void {
    file.text().then(text => {
      try {
        const s = this.validateSave(JSON.parse(text));
        if (!s) { this.toast('That file is not a compatible save.'); return; }
        this.st = s;
        this.running = false;
        this.showSummary = s.ended;
        this.selection = { kind: 'none' };
        this.targeting = null;
        this.lastEventCount = s.events.length;
        this.toast(`${s.worldName} imported. Year ${Math.floor(s.tick / 4) + 1}.`);
        this.bump();
      } catch {
        this.toast('Could not read that file.');
      }
    });
  }

  // ---- misc UI ---------------------------------------------------------
  toast(text: string): void {
    this.toastMsg = { text, id: this.toastSeq++ };
    this.bump();
    const id = this.toastMsg.id;
    window.setTimeout(() => {
      if (this.toastMsg?.id === id) { this.toastMsg = null; this.bump(); }
    }, 4200);
  }
  setModal(m: 'none' | 'saves' | 'seed'): void { this.modal = m; this.bump(); }
  setLeftTab(t: 'chronicle' | 'myths' | 'charts'): void { this.leftTab = t; this.bump(); }
  focusEvent(id: number): void {
    this.leftTab = 'chronicle';
    this.focusEventId = id;
    this.bump();
  }
  closeOnboarding(): void {
    this.showOnboarding = false;
    localStorage.setItem('giab:seen', '1');
    this.bump();
  }
  openOnboarding(): void { this.showOnboarding = true; this.bump(); }
  setShowSummary(v: boolean): void { this.showSummary = v; this.bump(); }
  toggleMute(): void {
    this.muted = !this.muted;
    ambience.setMuted(this.muted);
    this.bump();
  }
}

export const game = new Game();

export function useGame(): number {
  return useSyncExternalStore(game.subscribe, game.snapshot);
}
