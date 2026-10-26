import { AudioLibrary } from '../../src/core/audio-library.js';
import { FOOTSTEP_MIX } from '../../src/core/footsteps.js';

let library, timer, finished, serial = 0;
const directions = { front: { x: 0, z: -3 }, right: { x: 3, z: -1 }, back: { x: 0, z: 3 }, left: { x: -3, z: -1 } };
export async function audition(id, direction, onDone) {
  const current = ++serial;
  clearTimeout(timer);
  finished?.(); finished = onDone;
  if (!library) {
    const ctx = new AudioContext(), dry = ctx.createGain(); dry.gain.value = 0.8; dry.connect(ctx.destination);
    ctx.listener.positionY.value = 1.7; ctx.listener.forwardZ.value = -1; ctx.listener.upY.value = 1;
    library = new AudioLibrary({ ctx, dry, revSend: ctx.createGain(), game: { camera: { position: { x: 0, y: 1.7, z: 0 } }, grid: { segmentClear: () => true } }, duckBeat() {} });
  }
  await library.ctx.resume();
  for (const voice of [...library.voices]) voice.stop(0.03);
  await library.loaded; await library.ensure(id);
  if (current !== serial) return;
  const pos = { ...directions[direction], y: 0.12 };
  let remaining = 6;
  const play = () => {
    if (current !== serial) return;
    library.play(id, { pos, volume: id === 'creature_step' ? FOOTSTEP_MIX.creatureWalk : 0.65 * FOOTSTEP_MIX.local, ref: id === 'creature_step' ? 3.2 : 1.6, rolloff: id === 'creature_step' ? 0.85 : 1.25, reverb: 0 });
    if (--remaining > 0) timer = setTimeout(play, 570);
    else timer = setTimeout(() => { finished?.(); finished = null; }, 900);
  };
  play();
}
export function stopAudition() {
  ++serial; clearTimeout(timer);
  finished?.(); finished = null;
  if (library) for (const voice of [...library.voices]) voice.stop(0.03);
}
