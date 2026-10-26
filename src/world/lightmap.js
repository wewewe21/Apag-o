// Mapa de luz do grid a partir das lampadas (sem three.js): a IA usa isto para decidir por onde anda e o quanto ve.
// Compartilhado entre o cliente (Lighting) e o servidor (sala multiplayer).
import { CELL } from '../config.js';

export function computeLightMap(grid, lamps) {
  const g = grid;
  g.light.fill(0);
  for (const l of lamps) {
    if (!l.on || l.state === 'dead' || l.type === 'emerg') continue;
    const p = l.power * (l.state === 'dying' ? 0.35 : 1);
    const R = Math.ceil(l.radius / CELL);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = l.cell[0] + dx, y = l.cell[1] + dy;
      if (!g.inb(x, y) || !(g.isFloor(x, y) || g.isDoor(x, y))) continue;
      const cx = g.cx(x), cz = g.cz(y);
      const d = Math.hypot(cx - l.x, cz - l.z);
      if (d > l.radius) continue;
      if (!g.segmentClear(l.x, l.z, cx, cz, true)) continue;
      const i = g.idx(x, y);
      g.light[i] = Math.min(1.3, g.light[i] + p * (1 - d / l.radius) * 1.25);
    }
  }
}

export function lightAt(grid, wx, wz) {
  const x = grid.cellX(wx), y = grid.cellY(wz);
  return grid.inb(x, y) ? grid.light[grid.idx(x, y)] : 0;
}
