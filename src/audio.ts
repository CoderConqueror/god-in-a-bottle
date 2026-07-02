// Synthesized ambience — WebAudio only, no assets. Muted by default.
class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  muted = true;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startWind();
    } catch {
      return null;
    }
    return this.ctx;
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brownish noise
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.18;
    src.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.master!);
    src.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!m) {
      const ctx = this.ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (this.master) this.master.gain.setTargetAtTime(0.5, ctx?.currentTime ?? 0, 0.4);
    } else if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noiseBurst(dur: number, vol: number, freq: number): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  // pentatonic divine chime
  chime(): void {
    const notes = [523.25, 587.33, 659.25, 783.99, 880];
    const n1 = notes[Math.floor(Math.random() * notes.length)];
    const n2 = notes[Math.floor(Math.random() * notes.length)];
    this.tone(n1, 2.2, 0.10);
    this.tone(n1 * 2, 2.6, 0.04, 'sine', 0.02);
    this.tone(n2, 2.4, 0.07, 'sine', 0.22);
  }

  thunder(): void { this.noiseBurst(1.6, 0.35, 140); }
  dark(): void { this.tone(72, 3.5, 0.16, 'triangle'); this.tone(96, 3.0, 0.08, 'sine', 0.3); }
  ui(): void { this.tone(880, 0.09, 0.035, 'triangle'); }
  era(): void {
    this.tone(261.63, 3.2, 0.07);
    this.tone(329.63, 3.2, 0.06, 'sine', 0.35);
    this.tone(392.0, 3.6, 0.06, 'sine', 0.7);
  }

  event(kind: string): void {
    if (this.muted) return;
    switch (kind) {
      case 'divine': this.chime(); break;
      case 'plague': case 'curse': case 'drought': this.dark(); break;
      case 'rain': case 'disaster': case 'war': this.thunder(); break;
      case 'era': this.era(); break;
      case 'ui': this.ui(); break;
    }
  }
}

export const ambience = new Ambience();
