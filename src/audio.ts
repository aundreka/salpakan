import click from './assets/sfx/click.wav';
import cta from './assets/sfx/cta.mp3';
import place from './assets/sfx/flip.mp3';
import move from './assets/sfx/pull.mp3';
import clash from './assets/sfx/reveal.wav';
import good from './assets/sfx/correct.mp3';
import bad from './assets/sfx/wrong.mp3';
import both from './assets/sfx/wrong-2.wav';
import start from './assets/sfx/transition-1.mp3';
import joined from './assets/sfx/pop-up.mp3';
import win from './assets/sfx/win.mp3';
import lose from './assets/sfx/endscene.mp3';
import timerLow from './assets/sfx/Digital Load Filler Bar Ui.mp3';

/**
 * Sound effects. One short clip per game event, played through cloned <audio>
 * nodes so overlapping hits do not cut each other off. Muted state is remembered.
 */
const SOURCES = { click, cta, place, move, clash, good, bad, both, start, joined, win, lose, timerLow } as const;
export type SoundName = keyof typeof SOURCES;

const GAIN: Partial<Record<SoundName, number>> = {
  click: 0.45, cta: 0.6, place: 0.6, move: 0.5, clash: 0.8, good: 0.6, bad: 0.6, both: 0.6,
  start: 0.6, joined: 0.6, win: 0.7, lose: 0.6, timerLow: 0.45,
};
const LS_SOUND = 'salpakan:sound';

class Sfx {
  enabled: boolean;
  private pool = new Map<SoundName, HTMLAudioElement>();

  constructor() {
    let on = true;
    try { on = localStorage.getItem(LS_SOUND) !== 'off'; } catch { /* ignore */ }
    this.enabled = on;
  }

  /** Create the base elements early so the first play is not delayed by a download. */
  preload(): void {
    for (const name of Object.keys(SOURCES) as SoundName[]) {
      if (this.pool.has(name)) continue;
      const a = new Audio(SOURCES[name]);
      a.preload = 'auto';
      this.pool.set(name, a);
    }
  }

  play(name: SoundName, opts: { volume?: number; delay?: number } = {}): void {
    if (!this.enabled) return;
    const base = this.pool.get(name) ?? new Audio(SOURCES[name]);
    const go = () => {
      const node = base.cloneNode(true) as HTMLAudioElement;
      node.volume = Math.min(1, (GAIN[name] ?? 0.7) * (opts.volume ?? 1));
      node.play().catch(() => { /* before the first user gesture the browser refuses; that is fine */ });
    };
    if (opts.delay) setTimeout(go, opts.delay);
    else go();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem(LS_SOUND, this.enabled ? 'on' : 'off'); } catch { /* ignore */ }
    return this.enabled;
  }
}

export const sfx = new Sfx();
