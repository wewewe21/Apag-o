import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DarkParanoia } from '../../src/entities/dark-paranoia.js';
import { PostFX } from '../../src/fx/postfx.js';
import { AudioLibrary } from '../../src/core/audio-library.js';
import { Grid } from '../../src/world/grid.js';
import { PLAYER } from '../../src/config.js';
import { mulberry32 } from '../../src/core/rng.js';

// A mesma planta e mobília construídas no cliente, sem renderizar texturas.
const noop = () => {};
globalThis.document = { createElement: () => {
  const canvas = { width: 1, height: 1 };
  canvas.getContext = () => new Proxy({
    canvas, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
  }, { get: (t, k) => k in t ? t[k] : noop, set: () => true });
  return canvas;
} };
const { World } = await import('../../src/world/world.js');
const world = new World(new THREE.Scene(), { texture: 16, lights: 0, shadow: 16, scale: 1 });
await world.build();

function makeGame(grid) {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 80);
  const scene = new THREE.Scene(); scene.add(camera);
  const holder = new THREE.Group(), spot = new THREE.SpotLight(); camera.add(holder); holder.add(spot);
  spot.intensity = 0;
  const calls = [];
  const game = {
    scene, camera, grid, state: 'playing', player: { pos: new THREE.Vector3(), hidden: null, dead: false, ghost: false },
    lighting: { lightAt: () => 0 }, ai: { state: 'patrol', pos: new THREE.Vector3(9, 0, 9) }, haunting: { toyActive: false },
    audio: { library: { play: (id, opts) => { calls.push({ id, opts }); return true; } } },
    makeNoise: () => { throw new Error('alucinação chamou a IA'); },
    flashlight: { on: false, battery: 1, spot, holder, beam: () => ({ on: true, pos: camera.position }), illum: () => 1 },
  };
  const paranoia = new DarkParanoia(game);
  paranoia._random = mulberry32(2941); paranoia.reset();
  return { game, paranoia, calls };
}
function stand(game, x, z, yaw = 0) {
  game.player.pos.set(x, game.grid.floorY(x, z), z);
  game.camera.position.copy(game.player.pos).y += PLAYER.eyeStand;
  game.camera.rotation.set(0, yaw, 0, 'YXZ'); game.camera.updateMatrixWorld();
}
function advance(paranoia, seconds) { for (let i = 0; i < Math.round(seconds * 20); i++) paranoia.update(0.05); }
const open = new Grid({ W: 30, H: 30, grid: Array.from({ length: 30 }, () => Array(30).fill('.')),
  zone: Array.from({ length: 30 }, () => Array(30).fill('p')), zones: { p: { level: 0 } } });
const { game, paranoia, calls } = makeGame(open); stand(game, 18, 18);
advance(paranoia, 12);
assert.ok(paranoia.darkSeconds <= 12.00001);
assert.ok(paranoia.strength < 0.00001); assert.equal(calls.length, 0, 'há um período inicial sem efeitos');
advance(paranoia, 24); assert.ok(Math.abs(paranoia.strength - 0.5) < 0.00001);
advance(paranoia, 24); assert.ok(Math.abs(paranoia.strength - 1) < 0.00001);
game.lighting.lightAt = () => 0.4;
advance(paranoia, 1); assert.ok(paranoia.strength < 0.9 && paranoia.strength > 0.7, 'recuperação gradual na luz');
advance(paranoia, 7); assert.equal(paranoia.strength, 0); assert.equal(paranoia.darkSeconds, 0);
game.lighting.lightAt = () => 0;

for (const broken of ['off', 'empty', 'unlit', 'spot-hidden', 'holder-hidden']) {
  paranoia.reset(); game.flashlight.on = broken !== 'off'; game.flashlight.battery = broken === 'empty' ? 0 : 1;
  game.flashlight.spot.intensity = broken === 'unlit' ? 0 : 55;
  game.flashlight.spot.visible = broken !== 'spot-hidden'; game.flashlight.holder.visible = broken !== 'holder-hidden';
  advance(paranoia, 20); assert.ok(paranoia.strength > 0.1, `${broken}: estado da lanterna não simula luz real`);
}
game.flashlight.on = true; game.flashlight.battery = 1; game.flashlight.spot.intensity = 55;
game.flashlight.spot.visible = game.flashlight.holder.visible = true;
advance(paranoia, 8); assert.equal(paranoia.strength, 0, 'feixe ativo e visível recupera a visão');
game.flashlight.on = false; game.flashlight.spot.intensity = 0;

const suppression = [
  ['paused', () => { game.state = 'paused'; }], ['reading', () => { game.state = 'reading'; }],
  ['map', () => { game.state = 'map'; }], ['title', () => { game.state = 'title'; }],
  ['hidden', () => { game.player.hidden = {}; }], ['chase', () => { game.ai.state = 'chase'; }],
  ['attack', () => { game.ai.state = 'attack'; }], ['inspect', () => { game.ai.state = 'inspect'; }],
  ['toy', () => { game.haunting.toyActive = true; }],
];
for (const [label, enter] of suppression) {
  game.state = 'playing'; game.player.hidden = null; game.ai.state = 'patrol'; game.haunting.toyActive = false;
  paranoia.reset(); advance(paranoia, 48); assert.ok(paranoia._spawnShadow(), 'controle positivo: cenário livre cria figura');
  const before = [paranoia.darkSeconds, paranoia.strength, paranoia._stepWait, paranoia._shadowWait, calls.length];
  enter(); advance(paranoia, 30);
  assert.deepEqual([paranoia.darkSeconds, paranoia.strength, paranoia._stepWait, paranoia._shadowWait, calls.length], before, `${label}: relógios congelados`);
  assert.equal(paranoia.group.visible, false); assert.equal(paranoia.group.parent, null, `${label}: figura não fica pendurada na cena`);
}
game.state = 'playing'; game.player.hidden = null; game.ai.state = 'patrol'; game.haunting.toyActive = false;
for (const flag of ['dead', 'ghost']) {
  paranoia.reset(); advance(paranoia, 48); assert.ok(paranoia._spawnShadow()); game.player[flag] = true;
  advance(paranoia, 20); assert.equal(paranoia.strength, 0); assert.equal(paranoia.darkSeconds, 0); assert.equal(paranoia.group.parent, null);
  game.player[flag] = false;
}
for (const state of ['dying', 'dead', 'ended', 'won']) {
  game.state = 'playing'; advance(paranoia, 30); game.state = state; paranoia.update(0.05); assert.equal(paranoia.strength, 0);
}
game.state = 'playing'; paranoia.reset(); paranoia.update(Number.NaN); paranoia.update(-1); assert.equal(paranoia.darkSeconds, 0);
paranoia.update(100); assert.ok(paranoia.darkSeconds <= 0.25, 'salto de tempo não gera rajada de alucinações');
paranoia.reset(); advance(paranoia, 60); paranoia._stepWait = paranoia._shadowWait = 1000;
assert.ok(paranoia._spawnShadow()); const figurePosition = paranoia.group.position.clone();
paranoia.update(0.1); assert.ok(paranoia.material.opacity > 0 && paranoia.material.opacity < 0.7);
assert.ok(paranoia.group.position.equals(figurePosition), 'figura imóvel');
advance(paranoia, 1.1); assert.equal(paranoia.group.parent, null, 'figura dura no máximo 1,1s');
assert.ok(paranoia._spawnShadow());
game.camera.lookAt(paranoia.group.position.clone().add(new THREE.Vector3(0, 1, 0))); paranoia.update(0.05);
assert.equal(paranoia.group.visible, false, 'olhar direto dissipa a figura');
stand(game, 18, 18); assert.ok(paranoia._spawnShadow());
const lit = paranoia.group.position.clone(); game.lighting.lightAt = (x, z) => Math.hypot(x - lit.x, z - lit.z) < 0.1 ? 0.5 : 0;
paranoia.update(0.05); assert.equal(paranoia.group.visible, false, 'luz na posição da figura dissipa-a');
game.lighting.lightAt = () => 0;
assert.ok(paranoia._spawnShadow()); game.flashlight.on = true; game.flashlight.spot.intensity = 55;
assert.equal(paranoia._beamOnShadow(paranoia.group.position), true, 'feixe alcança a figura');
paranoia.update(0.05); assert.equal(paranoia.group.visible, false, 'lanterna dissipa a figura');
game.flashlight.on = false; game.flashlight.spot.intensity = 0;

const originalChildren = paranoia.group.children.slice(), originalMaterial = paranoia.material;
for (let i = 0; i < 100; i++) { assert.ok(paranoia._spawnShadow()); paranoia.reset(); }
assert.deepEqual(paranoia.group.children, originalChildren); assert.equal(paranoia.material, originalMaterial);
assert.equal(game.scene.children.includes(paranoia.group), false, 'reset reutiliza recursos sem acumular objetos');
const beforeCadence = calls.length; paranoia.reset(); advance(paranoia, 240);
const steps = calls.slice(beforeCadence);
assert.ok(steps.length >= 5 && steps.length <= 14, `cadência espaçada: ${steps.length} passos em quatro minutos`);
assert.ok(steps.every(s => s.id === 'phantom_step' && s.opts.pos && s.opts.volume <= 0.1651 && !s.opts.important));
assert.equal(game.ai.state, 'patrol'); assert.deepEqual(game.ai.pos.toArray(), [9, 0, 9]);

// A rota real de AudioLibrary mantém fonte mono HRTF, sem prioridade sobre inimigo.
class Param { constructor(v = 0) { this.value = v; } setTargetAtTime(v) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class AudioNode { constructor() { for (const k of ['gain', 'frequency', 'Q', 'playbackRate', 'positionX', 'positionY', 'positionZ']) this[k] = new Param(); } connect() {} disconnect() {} start() {} stop() {} }
const ctx = { currentTime: 0, createGain: () => new AudioNode(), createPanner: () => new AudioNode(), createBiquadFilter: () => new AudioNode(), createBufferSource: () => new AudioNode() };
const host = { ctx, game, dry: new AudioNode(), revSend: new AudioNode() };
const library = Object.assign(Object.create(AudioLibrary.prototype), { ctx, host, buffers: new Map([['phantom_step', [{ duration: 0.6 }]]]), lastVariant: new Map(), variantBags: new Map(), lastPlay: new Map(), voices: new Set(), loops: new Map(), stats: { played: 0 }, duckUntil: 0 });
assert.equal(library.play(steps[0].id, steps[0].opts), true);
const voice = [...library.voices][0]; assert.equal(voice.route.panner.panningModel, 'HRTF'); assert.equal(voice.route.panner.channelCount, 1); assert.equal(voice.important, false);
const enemyVoice = { id: 'creature_step', stop: () => { throw new Error('paranoia silenciou a criatura'); } };
library.voices.add(enemyVoice); const oldLibrary = game.audio.library; game.audio.library = library;
game.state = 'paused'; paranoia.update(0.05);
assert.equal(library.voices.has(voice), false, 'passo falso em andamento é interrompido no menu');
assert.equal(library.voices.has(enemyVoice), true, 'pista da criatura preservada');
game.audio.library = oldLibrary; game.state = 'playing';

// Prova espacial contra mapa completo: mobília, portas fechadas e os dois pisos.
const actual = makeGame(world.grid), grid = world.grid;
const boxesBefore = grid.boxes.map(b => b.length), navBefore = grid.navBlock.slice(), propCount = world.propBoxes.length;
let valid = 0, downstairs = 0;
for (let cy = 0; cy < grid.H; cy += 2) for (let cx = 0; cx < grid.W; cx += 2) {
  if (!grid.isFloor(cx, cy) || !grid.navWalkable(cx, cy, 'player')) continue;
  const x = grid.cx(cx), z = grid.cz(cy), [fx, fz] = grid.collideCircle(x, z, PLAYER.radius);
  if (Math.hypot(fx - x, fz - z) > 0.001 || grid.char(cx, cy) === '=') continue;
  for (let dir = 0; dir < 8; dir++) {
    stand(actual.game, x, z, dir * Math.PI / 4);
    const point = actual.paranoia._candidate(true); if (!point) continue;
    valid++; if (point.y < -1) downstairs++;
    const tx = grid.cellX(point.x), ty = grid.cellY(point.z);
    assert.ok(grid.isFloor(tx, ty)); assert.equal(grid.floorY(point.x, point.z), point.y);
    assert.ok(Math.abs(point.y - actual.game.player.pos.y) <= 0.18, 'mesmo piso');
    assert.ok(grid.segmentClear(x, z, point.x, point.z, true), 'LOS real');
    assert.ok(grid.findPath(cx, cy, tx, ty, { agent: 'player', maxNodes: 600 }), 'rota acessível com portas reais');
    const [freeX, freeZ] = grid.collideCircle(point.x, point.z, PLAYER.radius);
    assert.ok(Math.hypot(freeX - point.x, freeZ - point.z) < 0.01, 'fora de mobília e paredes');
    // Verificação independente: o jogador consegue percorrer o caminho reto até lá.
    const n = Math.ceil(Math.hypot(point.x - x, point.z - z) / 0.12);
    for (let k = 0; k <= n; k++) {
      const px = x + (point.x - x) * k / n, pz = z + (point.z - z) * k / n;
      const [qx, qz] = grid.collideCircle(px, pz, PLAYER.radius);
      assert.ok(Math.hypot(qx - px, qz - pz) < 0.015, 'corredor livre com raio do jogador');
    }
    const ndc = point.clone().add(new THREE.Vector3(0, 1, 0)).project(actual.game.camera);
    assert.ok(Math.abs(ndc.x) >= 0.55 && Math.abs(ndc.x) <= 0.94 && Math.abs(ndc.y) <= 0.72, 'periferia visível');
  }
}
assert.ok(valid >= 40 && downstairs >= 8, `${valid} posições reais, ${downstairs} no subsolo`);
assert.deepEqual(grid.boxes.map(b => b.length), boxesBefore); assert.deepEqual(grid.navBlock, navBefore); assert.equal(world.propBoxes.length, propCount);
// Controle negativo: uma barreira física e outro nível realmente bloqueiam posições.
stand(game, 18, 18); assert.equal(paranoia._reachable(18, 23, 0), true);
open.addBox({ x0: 15, x1: 21, z0: 20, z1: 20.3, vision: true });
assert.equal(paranoia._reachable(18, 23, 0), false); assert.equal(paranoia._reachable(16, 18, -4), false);

const post = new PostFX({}); assert.equal(post.uniforms.paranoia.value, 0);
paranoia.group.updateMatrixWorld();
const silhouetteBounds = new THREE.Box3().setFromObject(paranoia.group);
assert.ok(silhouetteBounds.min.y - paranoia.group.position.y < 0.03, 'a silhueta alcança o piso sem flutuar');
// Regressão visual: a percepção deve contrastar com o preto mesmo sem luz física.
const smokeLuma = color => color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
const visibleSmoke = color => smokeLuma(color) > 0.07 && smokeLuma(color) < 0.14;
assert.equal(visibleSmoke(new THREE.Color(0x010203)), false, 'controle negativo: material anterior perdia-se sob o grão');
assert.equal(visibleSmoke(paranoia.material.color), true, 'cinza discreto acima do preto/grão sem virar branco');
assert.equal(paranoia.material.isMeshBasicMaterial, true, 'efeito perceptual independente das lâmpadas');
assert.equal(paranoia.material.blending, THREE.NormalBlending, 'sem brilho aditivo');
assert.equal(paranoia.material.fog, true, 'figura continua atenuada pela névoa do ambiente');
assert.ok(paranoia.group.children.every(o => !o.isLight && !o.castShadow), 'nenhuma fonte de luz ou sombra física');
const source = readFileSync(new URL('../../src/fx/postfx.js', import.meta.url), 'utf8');
assert.match(source, /smoothstep\(0\.22, 0\.65, length\(\(vUv - 0\.5\) \* vec2\(1\.0, 0\.9\)\)\)/);
assert.match(source, /col \*= 1\.0 - paranoiaAmount \* 0\.28/);
assert.match(source, /paranoiaAmount \* 0\.12/);
assert.match(source, /paranoiaEdge \* \(1\.0 - ghost\)/);
paranoia.dispose(); actual.paranoia.dispose();
console.log(`PARANOIA VERIFIED: graça/rampa/recuperação, supressão, HRTF, ciclo de vida e ${valid} posições no mapa (${downstairs} no subsolo).`);
