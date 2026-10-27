// Espirito: atravessa paredes que separam dois comodos, mas nunca sai do predio (barreira externa).
// Usa a mesma regra do cliente (Player._updateGhost) e do servidor (Match._ghostState): Grid.ghostWalkable / ghostMove.
import { buildLayout } from '../../src/world/layout.js';
import { Grid } from '../../src/world/grid.js';
import { CELL } from '../../src/config.js';

const g = new Grid(buildLayout());
let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) ok++; else { fail++; console.log('FALHA:', msg); } };
const open = (x, y) => g.isFloor(x, y) || g.isDoor(x, y);
const cxw = (x) => (x + 0.5) * CELL, czw = (y) => (y + 0.5) * CELL;

// 1) parede fina entre dois pisos: o espirito passa de um lado ao outro
let thin = null, thinCount = 0;
for (let y = 0; y < g.H && !thin; y++) for (let x = 1; x < g.W - 1; x++) {
  if (g.char(x, y) === '#' && open(x - 1, y) && open(x + 1, y)) { thin = [x, y]; break; }
}
check(!!thin, 'o mapa tem alguma parede fina entre dois comodos');
if (thin) {
  const [x, y] = thin, z = czw(y);
  check(g.ghostWalkable(cxw(x), z), 'celula da parede fina e atravessavel');
  // anda em passos curtos (como no jogo) do piso da esquerda ao da direita
  let px = cxw(x - 1), pz = z;
  for (let i = 0; i < 200 && px < cxw(x + 1); i++) [px, pz] = g.ghostMove(px, pz, px + 0.05, pz);
  check(px >= cxw(x + 1) - 0.06, `atravessou a parede fina em (${x},${y}) (parou em ${px.toFixed(2)})`);
}

// 2) parede externa: nenhuma celula de fora do predio vale; andar sempre para fora nunca escapa
let outside = 0, bad = 0;
for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
  if (g.isFloor(x, y) || g.isDoor(x, y)) continue;
  if (!g.isWallish(x, y)) continue;
  const okCell = (a, b) => open(a, b);
  const between = (okCell(x - 1, y) && okCell(x + 1, y)) || (okCell(x, y - 1) && okCell(x, y + 1));
  if (g.ghostWalkable(cxw(x), czw(y)) !== between) bad++;
  outside++;
}
check(bad === 0, `regra de celula de parede coerente em ${outside} celulas (${bad} divergentes)`);

// 3) de cada piso, empurrar em cada direcao por muito tempo nunca leva para uma celula invalida
let escaped = 0, tested = 0;
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
for (let y = 0; y < g.H; y += 3) for (let x = 0; x < g.W; x += 3) {
  if (!g.isFloor(x, y)) continue;
  for (const [dx, dz] of dirs) {
    let px = cxw(x), pz = czw(y);
    for (let i = 0; i < 400; i++) [px, pz] = g.ghostMove(px, pz, px + dx * 0.1, pz + dz * 0.1);
    tested++;
    if (!g.ghostWalkable(px, pz)) escaped++;
  }
}
check(escaped === 0, `ninguem saiu do predio (${tested} caminhadas longas, ${escaped} fugas)`);
// os limites do mapa em si
check(!g.ghostWalkable(-1, -1) && !g.ghostWalkable(g.W * CELL + 1, 5) && !g.ghostWalkable(5, g.H * CELL + 1), 'fora da grade nao vale');

console.log(`Resultado: ${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
