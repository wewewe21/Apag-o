// "Especificacao" do mundo para o servidor: tudo que a simulacao precisa saber do mapa, sem malhas nem texturas.
// extractSpec() le um World ja construido (no Node, pelo script gen-worldspec, ou no navegador, para o teste de deriva).
import * as THREE from 'three';
import { CELL } from '../config.js';
import { EXTRA_FUSES } from './coop.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const vec = (v) => [r3(v.x), r3(v.y), r3(v.z)];

export function extractSpec(world) {
  const g = world.grid;
  const spec = { version: 1, cell: CELL, W: g.W, H: g.H };
  spec.propBoxes = world.propBoxes.map(b => [r3(b.x0), r3(b.x1), r3(b.z0), r3(b.z1), b.vision ? 1 : 0]);
  spec.navBlock = []; for (let i = 0; i < g.navBlock.length; i++) if (g.navBlock[i]) spec.navBlock.push(i);
  spec.hideSpots = world.hideSpots.map(s => ({
    type: s.type, x: r3(s.x), z: r3(s.z), base: r3(s.base), yaw: r3(s.yaw), cell: s.cell,
    fwd: vec(s.fwd), camPos: vec(s.camPos), exitPos: vec(s.exitPos), inspectPos: vec(s.inspectPos),
  }));
  spec.vents = world.vents.map(v => ({ x: r3(v.x), z: r3(v.z), base: r3(v.base), cell: v.cell, mouth: vec(v.mouth) }));
  spec.lamps = world.lighting.lamps.map(l => ({
    type: l.type, x: r3(l.x), z: r3(l.z), y: r3(l.y), base: l.base, sector: l.sector, state: l.state0 ?? l.state,
    power: l.power, radius: l.radius, cell: l.cell,
  }));
  spec.creatureSpawn = { x: r3(world.creatureSpawn.x), z: r3(world.creatureSpawn.z) };
  spec.playerStart = { x: r3(world.playerStart.x), z: r3(world.playerStart.z), yaw: r3(world.playerStart.yaw) };
  spec.exitTrigger = { x: r3(world.exitTrigger.x), z: r3(world.exitTrigger.z) };
  spec.panelCell = [world.panelSpec.x, world.panelSpec.y];
  const pp = world.anchor(world.panelSpec.x, world.panelSpec.y, [0, 1], 0.2);
  spec.panel = { x: r3(pp.x), y: 1.2, z: r3(pp.z), yaw: r3(world.yawFacingAway([0, 1])) };

  // itens que valem no cooperativo (fusiveis do layout, chave, pilhas). key = tipo:id ou tipo:indice em world.items
  spec.items = [];
  world.items.forEach((it, i) => {
    if (!['fuse', 'key', 'battery'].includes(it.type)) return;
    const p = it.mesh.getWorldPosition(new THREE.Vector3());
    spec.items.push({ key: it.type + ':' + (it.id ?? i), type: it.type, id: it.id ?? null, x: r3(p.x), y: r3(p.y), z: r3(p.z) });
  });
  // gaveta 13: o fusivel 4 so aparece depois que a gaveta abre; o ponto de interacao e a frente da gaveta
  const d13 = world.drawers.find(d => d.num === 13);
  spec.drawers = world.drawers.map(d => ({ num: d.num, x: r3(d.x), y: r3(d.y), z: r3(world.drawerBank.zf + 0.3) }));
  spec.items.push({ key: 'fuse:4', type: 'fuse', id: 4, drawer: 13, x: r3(d13.x), y: r3(d13.y), z: r3(world.drawerBank.zf + 0.5) });
  // fusiveis extras do cooperativo (6 e 7): em cima de moveis que ja existem
  for (const e of EXTRA_FUSES) {
    const s = world.surfaces.get(e.surface.join(','));
    if (!s) throw new Error('superficie nao encontrada para o fusivel extra ' + e.id + ' em ' + e.surface);
    spec.items.push({ key: 'fuse:' + e.id, type: 'fuse', id: e.id, x: r3(s.x), y: r3(s.y + 0.002), z: r3(s.z), extra: true });
  }
  spec.items.sort((a, b) => a.key.localeCompare(b.key));
  return spec;
}
