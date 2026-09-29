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
    music = ctx.createGain();
    music.gain.value = musicVol;
    music.connect(master);
    setInterval(schedule, 100);
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

// Music: a procedural pentatonic arpeggio over a drone, scheduled ~0.3s ahead. The mood sets
// tempo and register: calm while building, quicker in waves, lower and louder for bosses.
// ponytail: one fixed scale and random walk; swap in composed patterns if it gets repetitive.
export type Mood = 'build' | 'wave' | 'boss' | 'off';
const MOODS = {
  build: { step: 0.5, root: 220, gain: 0.12 },
  wave: { step: 0.28, root: 220, gain: 0.14 },
  boss: { step: 0.2, root: 147, gain: 0.2 },
};
const SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic, semitones over the root
let music: GainNode | null = null;
let musicVol = 0.3;
let mood: Mood = 'build';
let nextAt = 0,
  beat = 0,
  deg = 0;

export function setMusic(v: number) {
  musicVol = v;
  if (music) music.gain.value = v;
}
export function setMood(m: Mood) {
  mood = m;
}

function note(type: OscillatorType, f: number, t: number, len: number, gain: number) {
  const o = ctx!.createOscillator(),
    g = ctx!.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.05, len / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(music!);
  o.start(t);
  o.stop(t + len);
}

function schedule() {
  if (!ctx || !music || mood === 'off' || !musicVol || ctx.state !== 'running') return;
  const m = MOODS[mood];
  nextAt = Math.max(nextAt, ctx.currentTime);
  while (nextAt < ctx.currentTime + 0.3) {
    if (beat % 8 === 0) note('sine', m.root / 2, nextAt, m.step * 8, m.gain); // drone
    deg = Math.max(0, Math.min(SCALE.length - 1, deg + Math.floor(Math.random() * 3) - 1));
    if (Math.random() < 0.8)
      note('triangle', m.root * 2 ** (SCALE[deg] / 12), nextAt, m.step * 1.5, m.gain * 0.6);
    nextAt += m.step;
    beat++;
  }
}
