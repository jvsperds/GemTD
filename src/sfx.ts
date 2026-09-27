// WebAudio-synthesised SFX (BUILD.md §3.1): no audio files. Created lazily on first user input.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;
const lastAt: Record<string, number> = {};

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
}

/** Call from a user gesture; browsers keep audio suspended until then. */
export function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

type Sound = [type: OscillatorType, from: number, to: number, time: number, gain: number];
const SOUNDS: Record<string, Sound[]> = {
  place: [['triangle', 660, 990, 0.08, 0.3]],
  keep: [
    ['sine', 520, 520, 0.08, 0.3],
    ['sine', 780, 780, 0.12, 0.25],
  ],
  kill: [['square', 300, 80, 0.07, 0.08]],
  leak: [['sawtooth', 120, 50, 0.3, 0.3]],
  wave: [['triangle', 220, 440, 0.25, 0.25]],
  win: [
    ['sine', 523, 523, 0.15, 0.3],
    ['sine', 659, 659, 0.15, 0.3],
    ['sine', 784, 784, 0.4, 0.3],
  ],
  lose: [['sawtooth', 300, 60, 0.9, 0.3]],
  refuse: [['square', 140, 140, 0.08, 0.15]],
};

/** Play a named sound; each name is throttled so bursts (kills) don't stack into noise. */
export function play(name: keyof typeof SOUNDS) {
  if (!ctx || !master || !volume) return;
  const now = ctx.currentTime;
  if (now - (lastAt[name] ?? -1) < 0.05) return;
  lastAt[name] = now;
  let t = now;
  for (const [type, from, to, time, gain] of SOUNDS[name]) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + time);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + time);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + time);
    t += time * 0.8;
  }
}
