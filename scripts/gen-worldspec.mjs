// Gera server/worldspec.json: monta o World do jogo no Node (sem navegador: canvas falso, texturas minimas)
// e extrai colisao, esconderijos, dutos, lampadas e itens para o servidor multiplayer.
// Uso: node scripts/gen-worldspec.mjs   (o npm run build:server chama isto)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- canvas falso: as texturas nao importam para a simulacao, so precisam nao quebrar ----
const noop = () => {};
function fakeCtx(w, h) {
  const target = {
    createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }),
    getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }), canvas: { width: w, height: h },
  };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
}
globalThis.document = {
  createElement: () => { const c = { width: 1, height: 1 }; c.getContext = () => fakeCtx(c.width, c.height); return c; },
};

const { World } = await import('../src/world/world.js');
const { extractSpec } = await import('../src/shared/worldspec.js');
const THREE = await import('three');

const scene = new THREE.Scene();
const world = new World(scene, { texture: 16, lights: 0, shadow: 16, scale: 1 }, () => {});
const t0 = performance.now();
await world.build();
const spec = extractSpec(world);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../server/worldspec.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec));
console.log(`worldspec: ${spec.propBoxes.length} caixas, ${spec.hideSpots.length} esconderijos, ${spec.vents.length} dutos, ${spec.lamps.length} lampadas, ${spec.items.length} itens -> ${out} (${(performance.now() - t0).toFixed(0)} ms)`);
process.exit(0);
