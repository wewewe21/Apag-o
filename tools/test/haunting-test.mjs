import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Haunting } from '../../src/entities/haunting.js';
import { AudioLibrary } from '../../src/core/audio-library.js';
import { Grid } from '../../src/world/grid.js';
import { buildLayout } from '../../src/world/layout.js';
import { loadSave, writeSave } from '../../src/core/save.js';

class Param {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
class AudioNode {
  constructor() { for (const k of ['gain', 'frequency', 'Q', 'playbackRate', 'positionX', 'positionY', 'positionZ']) this[k] = new Param(); }
  connect() {}
  disconnect() { this.disconnected = true; }
  start(time, offset) { this.offset = offset; }
  stop() { this.stopped = true; }
}
const ctx = { currentTime: 0, createGain: () => new AudioNode(), createBufferSource: () => new AudioNode(), createPanner: () => new AudioNode(), createBiquadFilter: () => new AudioNode() };
const grid = new Grid(buildLayout());
let starts = 0, elapsed = 0, distance = Infinity;
const ward = {
  hauntedRoomId: 'child-1', toy: new THREE.Group(),
  roomAt: p => grid.cellX(p.x) === 2 && grid.cellY(p.z) === 14 && Math.abs(p.y) < 1.5 ? 'child-1' : null,
  startToy: () => { starts++; elapsed = 0; },
  update: dt => { elapsed += dt; ward.toy.position.x += dt * 0.06; },
  reset: () => { elapsed = 0; ward.toy.position.set(grid.cx(2), 0.04, grid.cz(14)); },
};
const game = {
  mode: 'normal', state: 'playing', grid, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
  player: { pos: new THREE.Vector3(grid.cx(5), 0, grid.cz(14)), stamina: 1, dead: false, ghost: false },
  ai: { state: 'dormant' }, world: { childWard: ward, doorsList: [] }, lighting: { lamps: [] },
  paranoia: { strength: 0 }, monsterDistance: () => distance, lastCheckpoint: { installed: [1] },
  makeNoise: () => { throw new Error('Presenca nao deve emitir ruido para IA'); },
};
const host = { ctx, game, dry: new AudioNode(), revSend: new AudioNode(), amb: new AudioNode(), rain: new AudioNode(), breathG: new AudioNode(), hums: [] };
const lib = Object.assign(Object.create(AudioLibrary.prototype), {
  host, ctx, buffers: new Map(), pending: new Map(), entries: {}, failed: new Set(),
  lastVariant: new Map(), variantBags: new Map(), lastPlay: new Map(), voices: new Set(), loops: new Map(),
  stats: { played: 0 }, ghostTimer: 500, musicId: null, candidateTime: 0, duckUntil: 0,
});
for (const [id, duration, variants] of [['toy_music', 10, 1], ['children_laughter', 24, 1], ['haunt_door_knock', 3, 3], ['morgue_glass', 2.5, 2]]) {
  lib.buffers.set(id, Array.from({ length: variants }, () => ({ duration })));
}
game.audio = { library: lib };
const mem = new Map(), originalStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: k => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
const advance = (dt = 0.1) => { ctx.currentTime += dt; game.haunting.update(dt); };
const move = (x, y, base = 0) => game.player.pos.set(grid.cx(x), base, grid.cz(y));
try {
  writeSave({ installed: [1], taken: ['key:0'], battery: 0.7 });
  const h = game.haunting = new Haunting(game, () => 0.5);
  advance();
  assert.ok(h.laughter && h.laughter.volume < 0.4, 'risadas discretas no corredor');
  lib.update(0.1, { zone: { level: 0 }, fear: 0 });
  const laughterRoute = lib.loops.get('children_laughter').route;
  assert.equal(laughterRoute.panner.panningModel, 'HRTF');
  game.camera.position.set(grid.cx(5), 1.7, grid.cz(13));
  lib._refreshSpatial(laughterRoute, true);
  assert.equal(laughterRoute.occluded, true, 'parede do corredor continua abafando a voz');
  assert.ok(laughterRoute.filter.frequency.value > 850 && laughterRoute.filter.frequency.value < 3500, 'voz legivel sem eliminar a oclusao');
  assert.ok(laughterRoute.muffle.gain.value > 0.55 && laughterRoute.muffle.gain.value < 1, 'atenuacao parcial conserva a origem no quarto');
  game.camera.position.set(grid.cx(5), 1.7, grid.cz(14));
  lib._refreshSpatial(laughterRoute, true);
  assert.equal(laughterRoute.occluded, false, 'linha livre pela abertura remove o abafamento');
  assert.equal(laughterRoute.muffle.gain.value, 1);
  move(5, 11); advance(); lib.update(0.1, { zone: { level: 0 }, fear: 0 });
  assert.equal(h.laughter, null); assert.equal(lib.loops.get('children_laughter').target, 0, 'sair faz fade');
  move(5, 14); advance(); assert.ok(h.laughter, 'cada revisita traz as risadas');
  move(8, 14); advance(); assert.equal(starts, 0, 'outro quarto nao ativa o brinquedo');
  move(2, 14, -4); advance(); assert.equal(starts, 0, 'outro andar nao conta');
  move(2, 14); advance();
  assert.equal(starts, 1); assert.equal(h.toySeen, true); assert.equal(h.toyActive, true);
  const voice = [...lib.voices].find(v => v.id === 'toy_music');
  assert.ok(voice); assert.equal(voice.route.panner.panningModel, 'HRTF');
  const oldX = voice.route.pos.x; advance(1);
  assert.ok(voice.route.pos.x > oldX, 'posicao 3D acompanha o brinquedo');
  const saved = loadSave();
  assert.deepEqual(saved.installed, [1]); assert.equal(saved.battery, 0.7);
  assert.deepEqual(saved.taken, ['key:0']); assert.deepEqual(saved.haunting, { toySeen: true });
  assert.deepEqual(game.lastCheckpoint.haunting, { toySeen: true }, 'morte preserva flag no checkpoint');
  const frozen = h.toyElapsed;
  game.state = 'reading'; advance(5);
  assert.equal(h.toyElapsed, frozen); assert.ok(![...lib.voices].some(v => v.id === 'toy_music'));
  game.state = 'playing'; advance(0.1);
  const resumed = [...lib.voices].find(v => v.id === 'toy_music');
  assert.ok(resumed.source.offset >= frozen, 'melodia retoma no instante da animacao');
  advance(10); assert.equal(h.toyActive, false); assert.ok(resumed.source.stopped);
  move(5, 14); advance(); move(2, 14); advance(); assert.equal(starts, 1, 'primeira e unica ativacao');
  h.reset(saved.haunting); advance(); assert.equal(starts, 1, 'continuar save nao repete');
  h.interrupt(); advance(); assert.equal(starts, 1, 'morte comum nao repete');
  h.reset(); advance(); assert.equal(starts, 2, 'nova partida permite novo encontro');
  game.player.dead = true; advance(); assert.equal(h.toyActive, false); assert.equal(h.laughter, null);
  game.player.dead = false; game.player.ghost = true; advance(); assert.equal(h.laughter, null);
  game.player.ghost = false; move(5, 14); advance();
  const calls = []; const realPlay = lib.play.bind(lib);
  lib.play = (id, opts) => { calls.push({ id, opts }); return realPlay(id, opts); };
  game.world.doorsList = [
    { kind: 'D', cx: grid.cx(4), cz: grid.cz(14), base: 0, open: 0 }, // too close
    { kind: 'D', cx: grid.cx(4), cz: grid.cz(18), base: 0, open: 0 },
    { kind: 'D', cx: grid.cx(6), cz: grid.cz(18), base: 0, open: 1 }, // open
    { kind: 'D', cx: grid.cx(4), cz: grid.cz(18), base: -4, open: 0 }, // other floor
    { kind: 'X', cx: grid.cx(4), cz: grid.cz(18), base: 0, open: 0 }, // exit
  ];
  h.quietTimer = 0; h.knockTimer = 0; advance();
  assert.equal(calls.at(-1).id, 'haunt_door_knock'); assert.equal(calls.at(-1).opts.pos.z, grid.cz(18));
  const count = calls.length; advance(1); assert.equal(calls.length, count, 'intervalo entre eventos');
  lib.update(0.1, { zone: { level: 0 }, fear: 0 });
  assert.ok(lib.loops.get('children_laughter').target > 0, 'vozes presentes antes da perseguicao');
  h.quietTimer = 0; h.knockTimer = 0; game.ai.state = 'chase'; distance = 4; advance(5);
  assert.equal(calls.length, count); assert.equal(h.laughter, null, 'perseguicao prioriza inimigo');
  lib.update(0.1, { zone: { level: 0 }, fear: 1 });
  assert.equal(lib.loops.get('children_laughter').target, 0, 'vozes cedem ao inimigo durante perseguicao');
  game.ai.state = 'patrol'; distance = Infinity; game.state = 'paused'; advance(5); assert.equal(calls.length, count);
  game.state = 'playing'; game.player.hidden = {}; advance(5); assert.equal(calls.length, count); game.player.hidden = null;
  h.knockTimer = 80; h.glassTimer = 0; h.quietTimer = 0;
  move(5, 14); advance(); assert.equal(calls.length, count, 'vidro nao soa fora do necroterio');
  move(20, 6); advance(); assert.equal(calls.at(-1).id, 'morgue_glass');
  assert.equal(grid.zoneAt(grid.cellX(calls.at(-1).opts.pos.x), grid.cellY(calls.at(-1).opts.pos.z)), 'm');
  assert.ok(calls.at(-1).opts.volume < 0.4); assert.ok(lib.ghostTimer >= 20);
  const normal = mem.get('apagao.save.v1');
  game.mode = 'hardcore'; h.reset(); move(2, 14); advance(); assert.equal(mem.get('apagao.save.v1'), normal);
  game.mode = 'online'; h.reset(); advance(); assert.equal(mem.get('apagao.save.v1'), normal);
  lib.play = realPlay;
  lib.reset(); assert.equal(lib.voices.size, 0); assert.equal(lib.loops.size, 0);
} finally { globalThis.localStorage = originalStorage; }
console.log('HAUNTING VERIFIED: entradas, persistencia sem alterar progresso, pausa, HRTF movel, eventos contextuais e prioridade do inimigo.');
