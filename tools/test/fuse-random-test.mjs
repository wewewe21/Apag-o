// Fusiveis sorteados a cada partida: nunca dois no mesmo lugar, regras de espalhamento, variedade de verdade e TODO sorteio e pegavel.
import fs from 'node:fs';
import { mulberry32 } from '../../src/core/rng.js';
import { pickFuseLayout, fuseItemDef, fuseHints } from '../../src/shared/fusespots.js';
import { COOP } from '../../src/shared/coop.js';
import { startHub, makeMatch, section, ok, T } from './harness.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../../server/worldspec.json', import.meta.url), 'utf8'));
const drawers = spec.drawers.map(d => ({ num: d.num, x: d.x, y: d.y, z: d.z + 0.2 }));
const ids7 = [1, 2, 3, 4, 5, 6, 7], ids5 = [1, 2, 3, 4, 5];

await section('Sorteio (puro): pontos distintos, espalhados, regras de sala e subsolo', async () => {
  ok(spec.fuseSpots.length >= 30, `ha pontos de sobra (${spec.fuseSpots.length} superficies + gavetas)`);
  const N = 3000;
  let dupPos = 0, dupId = 0, closeLt3 = 0, minD = 1e9, zoneBad = 0, bBad = 0, drawerBad = 0, wrongCount = 0, nearKey = 0;
  const seenSpot = new Map(), layouts = new Set(), drawerNums = new Set(), idAt = new Map();
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(1000 + i);
    const lay = pickFuseLayout(spec.fuseSpots, drawers, ids7, rng);
    if (lay.length !== 7) wrongCount++;
    const pos = lay.map(a => `${a.spot.x},${a.spot.z}`);
    if (new Set(pos).size !== lay.length) dupPos++;
    if (new Set(lay.map(a => a.id)).size !== lay.length) dupId++;
    for (let a = 0; a < lay.length; a++) for (let b = a + 1; b < lay.length; b++) { const d = Math.hypot(lay[a].spot.x - lay[b].spot.x, lay[a].spot.z - lay[b].spot.z); minD = Math.min(minD, d); if (d < 3) closeLt3++; }
    const zc = {}; let base = 0;
    for (const a of lay) { zc[a.spot.zone] = (zc[a.spot.zone] || 0) + 1; if (a.spot.basement) base++; if (a.drawer != null) { drawerNums.add(a.drawer); if (a.drawer === 13 || a.drawer === 23) drawerBad++; } seenSpot.set(a.spot.id, (seenSpot.get(a.spot.id) || 0) + 1); }
    for (const [z, n] of Object.entries(zc)) if (n > (z === 'p' ? 2 : 1)) zoneBad++;
    if (base < 1 || base > 2) bBad++;
    if (lay.some(a => ['r', 'h', 's', 'z', 'n', 'w', 'o'].includes(a.spot.zone))) zoneBad++;
    layouts.add(lay.map(a => a.spot.id + ':' + a.id).sort().join('|'));
  }
  ok(wrongCount === 0, `sempre 7 fusiveis (${N} sorteios)`);
  ok(dupPos === 0 && dupId === 0, 'nunca dois fusiveis no mesmo lugar, nunca o mesmo numero duas vezes');
  ok(closeLt3 === 0 && minD > 3, `nunca colados: menor distancia entre dois fusiveis em ${N} sorteios = ${minD.toFixed(1)} m`);
  ok(zoneBad === 0, 'no maximo 1 por sala (2 na Ala de Pacientes) e nunca na recepcao/corredor/Ala Noturna/cisterna');
  ok(bBad === 0, 'entre 1 e 2 fusiveis no subsolo em todo sorteio');
  ok(drawerBad === 0, 'a gaveta sorteada nunca e a 13 nem a 23');
  ok(layouts.size > N * 0.98, `cada sorteio e diferente (${layouts.size} distribuicoes distintas em ${N})`);
  const never = spec.fuseSpots.filter(s => !seenSpot.has(s.id));
  ok(never.length === 0, `todo ponto aparece em algum sorteio (${never.length} nunca sorteados: ${never.map(s => s.id).join(' ')})`);
  ok(drawerNums.size > 15, `a gaveta varia (${drawerNums.size} numeros diferentes)`);
  // solo: 5 fusiveis, so 1 no subsolo
  let sBad = 0;
  for (let i = 0; i < 500; i++) { const lay = pickFuseLayout(spec.fuseSpots, drawers, ids5, mulberry32(7 + i), { basementMax: 1 }); if (lay.length !== 5 || lay.filter(a => a.spot.basement).length !== 1) sBad++; }
  ok(sBad === 0, 'solo: 5 fusiveis com exatamente 1 no subsolo (500 sorteios)');
  // o mesmo seed repete o mesmo resultado (o solo guarda a semente no save)
  const A1 = pickFuseLayout(spec.fuseSpots, drawers, ids5, mulberry32(42)), A2 = pickFuseLayout(spec.fuseSpots, drawers, ids5, mulberry32(42));
  ok(JSON.stringify(A1) === JSON.stringify(A2), 'a mesma semente da a mesma distribuicao');
  // a mesa da chave nao recebe fusivel
  const keyDesk = spec.fuseSpots.filter(s => s.cell && Math.abs(s.cell[0] - 38) <= 1 && Math.abs(s.cell[1] - 14) <= 1);
  ok(keyDesk.length === 0, 'a mesa da chave nao esta entre os pontos');
  // pistas do livro de ocorrencias: 3 dos pontos reais, sem repetir
  const lay = pickFuseLayout(spec.fuseSpots, drawers, ids7, mulberry32(5));
  const hints = fuseHints(lay, mulberry32(6), 3);
  ok(hints.length === 3 && new Set(hints).size === 3 && hints.every(h => typeof h === 'string' && h.length > 5), 'pistas: 3 locais distintos');
});

const ctx = await startHub();
await section('Servidor: cada partida sorteia de verdade e TODO fusivel sorteado pode ser pego', async () => {
  const N = 24, seen = new Set(); let allDistinct = true, notTakable = [], total = 0;
  for (let i = 0; i < N; i++) {
    const { match, bots: [A] } = await makeMatch(ctx, 1, ['Ana'], { fuseRng: mulberry32(9000 + i) });
    const p = match.players.get(A.id), g = match.grid, w = match.world;
    const fuses = [...match.items.values()].filter(it => it.type === 'fuse');
    if (fuses.length !== COOP.fusesTotal) allDistinct = false;
    if (new Set(fuses.map(f => `${f.pos.x},${f.pos.z}`)).size !== fuses.length) allDistinct = false;
    seen.add(fuses.map(f => `${f.key}@${f.pos.x},${f.pos.z}`).sort().join('|'));
    // celulas alcancaveis a pe: tem a chave (K aberta), J so por dentro (fechada), X fechada, moveis bloqueiam
    const ps = w.playerStart, sx = g.cellX(ps.x), sy = g.cellY(ps.z), reach = new Set([sx + ',' + sy]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (reach.has(k) || !g.inb(nx, ny)) continue;
        const c = g.char(nx, ny);
        if (c === 'J' || c === 'X' || !(c === '.' || c === '=' || c === 'D' || c === 'K')) continue;
        if ((c === '.' || c === '=') && g.navBlock[g.idx(nx, ny)]) continue;
        reach.add(k); q.push([nx, ny]);
      }
    }
    for (const it of fuses) {
      total++;
      let got = false;
      for (let r = 0.3; r <= 2.9 && !got; r += 0.3) for (let a = 0; a < 24 && !got; a++) {
        const ang = a / 24 * Math.PI * 2, px = it.pos.x + Math.cos(ang) * r, pz = it.pos.z + Math.sin(ang) * r;
        const cx = g.cellX(px), cy = g.cellY(pz);
        if (!g.isFloor(cx, cy) || !reach.has(cx + ',' + cy)) continue;
        const [qx, qz] = g.collideCircle(px, pz, 0.32); if (Math.hypot(qx - px, qz - pz) > 0.02) continue;
        p.pos.set(px, g.floorY(px, pz), pz); p.updateEye(); p.hidden = null; p.status = 'alive';
        if (it.drawer != null) match.drawerOpen.set(it.drawer, true);
        const before = it.state; match.takeItem(p, it.key);
        if (it.state === 'carried') { got = true; it.state = before; it.by = null; p.carry.delete(it.key); if (it.drawer != null) match.drawerOpen.set(it.drawer, false); }
      }
      if (!got) notTakable.push(`${it.key}@${it.pos.x.toFixed(1)},${it.pos.z.toFixed(1)}${it.drawer != null ? ' gaveta ' + it.drawer : ''}`);
    }
  }
  ok(allDistinct, `${N} partidas: sempre 7 fusiveis, cada um num lugar diferente`);
  ok(seen.size === N, `cada partida tem uma distribuicao diferente (${seen.size} de ${N})`);
  ok(notTakable.length === 0, `todos os ${total} fusiveis sorteados podem ser pegos a pe com as regras reais do servidor (${notTakable.length} impossiveis: ${notTakable.slice(0, 5).join('; ')})`);
});

await section('Servidor: o sync leva a gaveta sorteada e a partida padrao (sem sorteio) continua igual a antiga', async () => {
  const { match, bots: [A] } = await makeMatch(ctx, 1, ['Ana'], { fuseRng: () => 0.5 });
  const sy = match.fullSync(match.players.get(A.id));
  const dr = sy.items.filter(i => i.dr != null);
  ok(sy.items.filter(i => i.key.startsWith('fuse:')).length === 7, 'o sync traz os 7 fusiveis');
  ok(dr.length <= 1 && dr.every(i => i.dr !== 13 && i.dr !== 23), 'no maximo 1 fusivel em gaveta, e traz o numero dela (dr)');
  const fixed = await makeMatch(ctx, 1, ['Bia']);                                  // padrao dos testes: lugares fixos
  const f4 = fixed.match.itemDefs.find(i => i.key === 'fuse:4');
  ok(f4.drawer === 13, 'com fixedFuses o fusivel 4 continua na gaveta 13 (base dos testes antigos)');
});

await ctx.stop();
console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
process.exit(T.fail ? 1 : 0);
