// Checagens do mapa sem navegador: conectividade, objetos em celulas validas, caminho da IA.
// Uso: node tools/test_layout.mjs
import { buildLayout, dumpAscii } from '../src/world/layout.js';
import { Grid } from '../src/world/grid.js';
import { CELL } from '../src/config.js';

const L = buildLayout();
const g = new Grid(L);
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FALHA:', msg); } };

console.log(dumpAscii(L));
// portas falsas para os testes (todas passaveis)
for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.isDoor(x, y)) g.doors.set(g.idx(x, y), { blocking: () => false, creaturePassable: () => true });

const start = L.objects.find(o => o.type === 'playerStart');
const sx = Math.floor(start.x), sy = Math.floor(start.y);
const reach = g.reachable(sx, sy);
const need = L.objects.filter(o => ['fuse', 'key', 'battery', 'note', 'locker', 'bed', 'vent', 'creatureSpawn', 'panel', 'emerg'].includes(o.type) && !o.drawer);
for (const o of need) {
  check(g.isFloor(o.x, o.y), `${o.type} ${o.id ?? ''} em (${o.x},${o.y}) nao e piso ('${g.char(o.x, o.y)}')`);
  check(reach[g.idx(o.x, o.y)], `${o.type} ${o.id ?? ''} em (${o.x},${o.y}) inalcancavel`);
}
// toda celula de piso alcancavel
let unreachable = 0;
for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.isFloor(x, y) && !reach[g.idx(x, y)]) unreachable++;
check(unreachable === 0, `${unreachable} celulas de piso inalcancaveis`);

// portas: cada porta precisa ter piso nos dois lados
for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
  if (!g.isDoor(x, y)) continue;
  const ax = g.doorAxis(x, y);
  const a = ax === 'h' ? [x, y - 1] : [x - 1, y], b = ax === 'h' ? [x, y + 1] : [x + 1, y];
  const c = g.char(x, y);
  if (c === 'X') continue;
  check(g.isFloor(...a) && g.isFloor(...b), `porta '${c}' em (${x},${y}) sem piso dos dois lados (${ax})`);
}

// A* do spawn da criatura ate o jogador
const cs = L.objects.find(o => o.type === 'creatureSpawn');
const path = g.findPath(cs.x, cs.y, sx, sy, { avoidLight: 2 });
check(path && path.length > 5, 'A* criatura -> jogador');
console.log('caminho criatura->jogador:', path?.length, 'celulas; suavizado:', g.smoothPath(path).length, 'pontos');

// linha de visao atraves de parede deve falhar, no corredor deve passar
check(!g.segmentClear(g.cx(7), g.cz(5), g.cx(7), g.cz(15)), 'LOS atravessando parede deveria bloquear');
check(g.segmentClear(g.cx(2), g.cz(10), g.cx(38), g.cz(10)), 'LOS ao longo do corredor norte deveria passar');

// escada: altura do piso
console.log('floorY topo/meio/base da escada:', g.floorY(42 * CELL + 0.1, g.cz(10)).toFixed(2), g.floorY(44.5 * CELL, g.cz(10)).toFixed(2), g.floorY(47 * CELL - 0.1, g.cz(10)).toFixed(2), g.floorY(g.cx(50), g.cz(10)).toFixed(2));
// colisao: empurrar para fora da parede
const [px, pz] = g.collideCircle(g.cx(9), 9.5 * CELL + 0.2, 0.32);
console.log('colisao perto da parede norte do corredor -> z', pz.toFixed(3), '(face da parede em', (9.5 * CELL + 0.1).toFixed(3), ')');
check(pz >= 9.5 * CELL + 0.1 + 0.319, 'colisao nao empurrou para fora da parede');

console.log('som: distancia pelo caminho (recepcao -> necroterio):', g.soundDistance(g.cx(25), g.cz(20), g.cx(20), g.cz(4), 200).toFixed(1), 'm');
console.log(fail ? `\n${fail} FALHA(S)` : '\nOK: todas as checagens passaram');
process.exit(fail ? 1 : 0);
