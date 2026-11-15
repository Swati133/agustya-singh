export type ToneType =
  | 'orb'
  | 'heal'
  | 'hit'
  | 'laser'
  | 'core'
  | 'win'
  | 'step'
  | 'fire'
  | 'explode'
  | 'sector'
  | 'triumph'
  | 'mystery_good'
  | 'mystery_bad';

class OfflineAudioSynth {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public play(type: ToneType): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'fire') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(760, now);
        osc.frequency.exponentialRampToValueAtTime(210, now + 0.07);
        gain.gain.setValueAtTime(0.035, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
        return;
      }

      if (type === 'explode') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
        return;
      }

      if (type === 'sector') {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = now + idx * 0.065;
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.1, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.24);
        });
        return;
      }

      if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.24);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.27);
        return;
      }

      if (type === 'laser') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.18);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.21);
        return;
      }

      if (type === 'win') {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = now + idx * 0.09;
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.12, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.3);
        });
        return;
      }

      if (type === 'triumph') {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = now + idx * 0.09;
          o.type = idx >= 4 ? 'sine' : 'triangle';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.14, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.58);
        });
        return;
      }

      if (type === 'mystery_good') {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = now + idx * 0.055;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.13, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.26);
        });
        return;
      }

      if (type === 'mystery_bad') {
        const notes = [392, 311.13, 233.08, 138.59];
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = now + idx * 0.065;
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.11, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t);
          o.stop(t + 0.22);
        });
        return;
      }

      osc.type = 'triangle';
      const startFreq =
        type === 'core' ? 660 : type === 'heal' ? 540 : type === 'step' ? 587 : 480;
      const endFreq = type === 'core' ? 990 : type === 'heal' ? 880 : 920;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.2);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } catch {
      // Audio playback blocked or unavailable; fail silently.
    }
  }
}

export const audioSynth = new OfflineAudioSynth();
