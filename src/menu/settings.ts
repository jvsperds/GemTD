import * as db from '../persist';
import * as sfx from '../sfx';
import { $ } from './dom';

/** Saved preferences; renderer-specific toggles remain owned by the renderer setup. */
export function initSettings(
  settings: db.Settings,
  setSpeed: (speed: number) => void,
  setVolume: (volume: number) => void,
) {
  const speed = $<HTMLSelectElement>('speed');
  const volume = $<HTMLInputElement>('volume');
  const music = $<HTMLInputElement>('music');
  const save = () => db.set('settings', settings);
  const refresh = () => {
    speed.value = String(settings.speed);
    volume.value = String(settings.volume);
    music.value = String(settings.music ?? 0.3);
  };
  speed.onchange = () => {
    settings.speed = +speed.value;
    setSpeed(settings.speed);
    void save();
  };
  volume.oninput = () => {
    settings.volume = +volume.value;
    setVolume(settings.volume);
    void save();
  };
  music.oninput = () => {
    settings.music = +music.value;
    sfx.setMusic(settings.music);
    void save();
  };
  refresh();
  return refresh;
}
