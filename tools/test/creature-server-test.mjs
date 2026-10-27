// Criatura no servidor (mesma IA do solo): colisao de corpo/cabeca, sem travar, percepcao previsivel e sensata, escolha de clipe.
// Uso: node tools/test/creature-server-test.mjs
import * as THREE from 'three';
import { CREATURE as C } from '../../src/config.js';
import { ok, section, T, startHub, makeMatch } from './harness.mjs';

const ctx = await startHub();
const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// ---------------------------------------------------------------------------
await section('Movimento: nunca atravessa parede/movel, nao trava, pes acompanham o chao', async () => {
  const { bots: [A, B], match } = await makeMatch(ctx, 2);
  const ai = match.ai, g = match.grid, m = ai.m;
  const pA = match.players.get(A.id), pB = match.players.get(B.id);
  match._wakeCreature(); ai.stateT = 1; ai.firstWalk = false; ai.pauseT = 0;
  const realPerceive = ai.perceive; ai.perceive = function () { this.sees = false; this.meter = 0; };     // so mede o movimento
  const cells = []; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.isFloor(x, y) && g.navWalkable(x, y) && g.levelBase(x, y) === 0 && g.zoneCfg(x, y) && !g.zoneCfg(x, y).outside) cells.push([x, y]);
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = () => cells[Math.floor(rnd() * cells.length)];
  const states = ['patrol', 'investigate', 'search', 'chase', 'flee'];
  const stuckInfo = [];
  let bodyPen = 0, headPen = 0, frames = 0, maxB = 0, maxH = 0, stuckWorst = 0, slide = [], wrongClip = 0, movingFrames = 0;
  let win = { t: 0, x: ai.pos.x, z: ai.pos.z, mv: 0 }, scene = 0, tScene = 0;
  const dt = 0.05, loco = new Set(['walk', 'limp', 'stalk', 'run', 'crawl', 'creep']);
  for (let i = 0; i < 20 * 60 * 5; i++) {                            // 5 minutos de jogo
    const t = i * dt;
    if (t >= tScene) {
      tScene = t + 14; const st = states[scene++ % states.length];
      const [cx, cy] = pick(), gx = g.cx(cx), gz = g.cz(cy), [px, py] = pick();
      for (const p of [pA, pB]) { const [qx, qy] = pick(); p.pos.set(g.cx(qx), g.floorY(g.cx(qx), g.cz(qy)), g.cz(qy)); p.updateEye(); }
      if (ai.level < 0) { const sp = match.world.creatureSpawn; ai.pos.set(sp.x, g.floorY(sp.x, sp.z), sp.z); }
      ai.meter = 0; ai.exposure = 0; ai.tgt = null; ai.knowT = 20;
      const V = (x, z) => new THREE.Vector3(x, 0, z);
      if (st === 'patrol') { ai.setState('patrol'); ai.goal = V(gx, gz); ai.pauseT = 0; ai._arrived = false; }
      else if (st === 'investigate') { ai.urgentInv = false; ai.setState('investigate', 'listen'); ai.goal = V(gx, gz); }
      else if (st === 'search') { ai.setState('search'); ai.searchAround(V(gx, gz)); }
      else if (st === 'chase') { ai.tgt = ai.nearestView(); ai.setState('chase'); ai.lastSeen.set(gx, 0, gz); ai.stateT = 0.5; }
      else if (st === 'flee') { ai.setState('flee'); ai.fleeGoal = V(gx, gz); }
      win = { t, x: ai.pos.x, z: ai.pos.z, mv: 0 };
    }
    if (ai.state === 'chase') ai.knowT = 5;
    const before = { x: ai.pos.x, z: ai.pos.z };
    match.tick(dt);
    if (ai.state === 'dormant') continue;
    frames++;
    const bp = (() => { const [qx, qz] = g.collideCircle(ai.pos.x, ai.pos.z, C.bodyRadius - 0.06, { ignore: (b) => !!b.door }); return Math.hypot(qx - ai.pos.x, qz - ai.pos.z); })();
    const hd = m.headWorld(new THREE.Vector3());
    const hp = (() => { const [qx, qz] = g.collideCircle(hd.x, hd.z, C.headRadius - 0.09, { ignore: (b) => !b.vision || !!b.door }); return Math.hypot(qx - hd.x, qz - hd.z); })();
    if (bp > 0.02) bodyPen++; if (hp > 0.02) headPen++; maxB = Math.max(maxB, bp); maxH = Math.max(maxH, hp);
    const sp = Math.hypot(ai.pos.x - before.x, ai.pos.z - before.z) / dt;
    if (sp > 0.5) {
      movingFrames++;
      if (!loco.has(m.current)) wrongClip++;
      else { const nat = m.clipSpeed(m.current) * m.actions[m.current].timeScale; if (nat > 0.05) slide.push(sp / nat); }
    }
    // travada: quer andar (seguindo caminho) mas nao sai do lugar por 3 s
    win.mv += sp > 0.3 ? 1 : 0;
    if (t - win.t >= 3) {
      const moved = Math.hypot(ai.pos.x - win.x, ai.pos.z - win.z), trying = ['patrol', 'investigate', 'search', 'chase', 'flee', 'stalk'].includes(ai.state) && ai.path.length > 0 && ai.pathI < ai.path.length && ai.bash <= 0 && ai.stateT > 1 && ai.pauseT <= 0;
      if (trying && moved < 0.3) { stuckWorst++; stuckInfo.push({ t: +t.toFixed(1), st: ai.state, sub: ai.sub, pos: [+ai.pos.x.toFixed(2), +ai.pos.z.toFixed(2)], wp: ai.path[ai.pathI]?.map(v => +v.toFixed(2)), pi: `${ai.pathI}/${ai.path.length}`, ms: +ai.moveSpeed.toFixed(2), yaw: +ai.yaw.toFixed(2), unstuck: ai._unstuckN, clip: m.current }); }
      win = { t, x: ai.pos.x, z: ai.pos.z, mv: 0 };
    }
  }
  ai.perceive = realPerceive;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  ok(frames > 4000, `simulou ${frames} quadros de criatura em 5 min`);
  ok(bodyPen === 0, `corpo nunca dentro de parede/movel (max ${maxB.toFixed(3)} m)`, bodyPen);
  ok(headPen === 0, `cabeca nunca dentro de parede/movel alto (max ${maxH.toFixed(3)} m)`, headPen);
  if (stuckInfo.length) console.log('  [travadas]', JSON.stringify(stuckInfo));
  ok(stuckWorst <= 2, `nao fica travada tentando andar (${stuckWorst} janelas de 3 s sem sair do lugar)`);
  ok(wrongClip / Math.max(1, movingFrames) < 0.03, `clipe de andar quase sempre certo (${(100 * wrongClip / Math.max(1, movingFrames)).toFixed(1)}% dos quadros em movimento com clipe parado)`);
  const md = med(slide);
  ok(md > 0.95 && md < 1.05 && slide.filter(r => r < 0.6 || r > 1.7).length / slide.length < 0.03, `pes acompanham o chao (razao velocidade/passo mediana ${md.toFixed(2)}, fora de 0,6-1,7 em ${(100 * slide.filter(r => r < 0.6 || r > 1.7).length / slide.length).toFixed(1)}%)`);
});

// ---------------------------------------------------------------------------
await section('Percepcao: previsivel (mesmas condicoes = mesmo tempo) e sensata', async () => {
  const { bots: [A], match } = await makeMatch(ctx, 1);
  const ai = match.ai, g = match.grid;
  match._wakeCreature(); ai.hardReset(); match.freezeAI = false;
  // corredor reto e longo no terreo
  let best = null;
  for (let y = 0; y < g.H; y++) { let run = 0, x0 = 0; for (let x = 0; x <= g.W; x++) { const okc = x < g.W && g.isFloor(x, y) && !g.navBlock[g.idx(x, y)] && g.levelBase(x, y) === 0 && g.zoneCfg(x, y) && !g.zoneCfg(x, y).outside; if (okc) { if (!run) x0 = x; run++; } else { if (run >= 20 && (!best || run > best.n)) best = { y, x0, n: run }; run = 0; } } }
  const z = g.cz(best.y), xs = g.cx(best.x0 + 1);
  const realLight = match.lighting.lightAt, realTargets = match.targets;
  const measure = (d, c, off = 0, maxS = 20) => {
    const view = { id: 9, pos: new THREE.Vector3(xs + d, g.floorY(xs + d, z), z), eye: new THREE.Vector3(xs + d, 1.6, z), hidden: null, holdingBreath: false, crouch: c.crouch || 0, sprinting: !!c.sprint, dead: false,
      fl: { on: !!c.fl, beam() { return { on: !!c.fl, pos: view.eye.clone(), dir: new THREE.Vector3(-1, 0, 0), angle: 0.4, focus: 0 }; }, illum() { return c.fl ? 1 : 0; } } };
    match.targets = () => [view]; match.lighting.lightAt = () => c.light;
    ai.hardReset(); ai.activate({ x: xs, z }); ai.firstWalk = false; ai.goal = null; ai.setState('patrol'); ai.stateT = 5; ai.aggr = 1;
    ai.pos.set(xs, g.floorY(xs, z), z); ai.yaw = Math.PI / 2 + off; ai.meter = 0; ai.pauseT = 999; ai.tgt = null; ai._tp = null;
    const li = g.idx(g.cellX(xs), g.cellY(z)), old = g.light[li]; g.light[li] = c.light;
    const savedCaught = match.onCaught; let tC = null, t = 0;
    for (let i = 0; i < maxS * 30 && tC == null; i++) {
      if (!c.still) { const w = Math.sin(t * 5.6) * 0.25; view.pos.z = z + w; view.eye.z = z + w; }
      ai.update(1 / 30); t += 1 / 30; ai.pos.set(xs, g.floorY(xs, z), z); ai.yaw = Math.PI / 2 + off;
      if (ai.state === 'chase' || ai.state === 'attack' || ai.state === 'hesitate') tC = t;     // hesitate = percebeu, mas esta em luz forte e nao avanca
    }
    g.light[li] = old; match.onCaught = savedCaught;
    return tC;
  };
  const lit = { light: 0.9 }, dark = { light: 0 };
  const a1 = measure(6, lit), a2 = measure(6, lit);
  ok(a1 === a2 && a1 != null, `deterministica: mesma condicao, mesmo tempo (${a1?.toFixed(2)} s e ${a2?.toFixed(2)} s)`);
  const tLit6 = a1, tDark6 = measure(6, dark), tDarkCrouch6 = measure(6, { ...dark, crouch: 1 }), tDarkStill6 = measure(6, { ...dark, still: true }), tFl = measure(10, { ...dark, fl: true });
  const tDark3 = measure(3, dark), tDark10 = measure(10, dark), tDark16 = measure(16, dark, 0, 14), tRun6 = measure(6, { ...dark, sprint: true });
  ok(tLit6 < tDark6, `luz ajuda a ser visto: claro ${tLit6.toFixed(1)} s < escuro ${tDark6.toFixed(1)} s (a 6 m, andando)`);
  ok(tDark3 < tDark6 && tDark6 < tDark10 && tDark10 < tDark16, `quanto mais longe, mais demora: ${[tDark3, tDark6, tDark10, tDark16].map(x => x?.toFixed(1)).join(' < ')} s`);
  ok(tDarkCrouch6 > tDark6 * 1.3, `agachar ajuda a se esconder (${tDarkCrouch6?.toFixed(1)} s contra ${tDark6.toFixed(1)} s)`);
  ok(tDarkStill6 > tDark6 * 1.1, `ficar parado ajuda (${tDarkStill6?.toFixed(1)} s contra ${tDark6.toFixed(1)} s andando)`);
  ok(tRun6 < tDark6, `correr chama mais atencao (${tRun6.toFixed(1)} s contra ${tDark6.toFixed(1)} s)`);
  ok(tFl != null && tFl < 1.2, `lanterna ligada denuncia quase na hora, ate a 10 m (${tFl?.toFixed(2)} s)`);
  ok(tDark3 < 2.6 && tDark6 < 3.5, `nao e injusto de propósito: de frente, no escuro, a 3 m leva ${tDark3.toFixed(1)} s e a 6 m ${tDark6.toFixed(1)} s (da tempo de reagir)`);
  ok(tLit6 < 2.5, `de frente, com luz, a 6 m ela percebe em ${tLit6.toFixed(1)} s (nao "olha e ignora")`);
  ok(measure(16, { ...dark, crouch: 1, still: true }, 0, 14) == null, 'agachado e parado no escuro a 16 m: ela nao percebe (furtividade tem recompensa)');
  const back = measure(6, dark, Math.PI, 14), side = measure(6, dark, Math.PI / 2, 14), diag = measure(6, dark, 0.7, 14);
  ok(back == null && side == null, 'de costas ou de lado (>80 graus) ela nao ve: so escuta/sente');
  ok(diag != null && diag > tDark6, `visao periferica (40 graus fora do eixo) funciona, um pouco mais lenta (${diag?.toFixed(1)} s contra ${tDark6.toFixed(1)} s)`);
  // sensor de proximidade: muito perto, ate de costas
  const near = measure(1.8, dark, Math.PI, 14), nearStill = measure(1.8, { ...dark, still: true, crouch: 1 }, Math.PI, 14);
  ok(near != null && near < 2.5, `sensor de proximidade: a 1,8 m ela sente mesmo de costas (${near?.toFixed(1)} s)`);
  ok(nearStill == null || nearStill > near * 2, 'agachado e imovel colado nela: sente bem mais devagar');
  match.lighting.lightAt = realLight; match.targets = realTargets;
});

// ---------------------------------------------------------------------------
await section('Investigar barulho: para, vira o rosto e depois vai (sem congelar com barulhos seguidos)', async () => {
  const { bots: [A], match } = await makeMatch(ctx, 1);
  const ai = match.ai, g = match.grid;
  match._wakeCreature(); ai.hardReset(); ai.activate(match.world.creatureSpawn); ai.stateT = 5; ai.firstWalk = false; ai.pauseT = 0; ai.goal = null;
  const p0 = ai.pos.clone(); ai.setState('patrol'); ai.stateT = 2;
  const target = g.randomCellNear(g.cellX(p0.x), g.cellY(p0.z), 5, 9, Math.random);
  const goal = new THREE.Vector3(g.cx(target[0]), 0, g.cz(target[1]));
  ai.investigate(goal, false);
  ok(ai.state === 'investigate' && ai.sub === 'listen', 'ao ouvir um barulho ela entra em "escuta" (para e vira o rosto)');
  let t = 0, turned = null, walking = null;
  for (let i = 0; i < 100 && !walking; i++) { match.tick(0.05); t += 0.05; if (ai.sub === 'walk' && walking == null) walking = t; }
  ok(walking != null && walking > 0.25 && walking < 1.2, `depois de ~${walking?.toFixed(2)} s ela parte para o barulho`);
  // barulhos seguidos nao reiniciam a escuta
  ai.setState('patrol'); ai.stateT = 2; ai.investigate(goal, false);
  for (let i = 0; i < 40; i++) { ai.hear(goal.x, goal.z, 12, 'passo'); match.tick(0.05); }
  ok(!(ai.state === 'investigate' && ai.sub === 'listen'), 'com barulhos seguidos ela nao fica presa virando para sempre');
});

// ---------------------------------------------------------------------------
const rigLight = async () => {                                   // partida nova por passo (se a criatura pega o jogador, o passo seguinte nao herda um jogador morto)
  const { bots: [A], match } = await makeMatch(ctx, 1);
  const ai = match.ai, g = match.grid, m = ai.m, pA = match.players.get(A.id);
  match._wakeCreature(); ai.hardReset(); match.freezeAI = false;
  let best = null;                                           // corredor reto e longo no terreo
  for (let y = 0; y < g.H; y++) { let run = 0, x0 = 0; for (let x = 0; x <= g.W; x++) { const okc = x < g.W && g.isFloor(x, y) && !g.navBlock[g.idx(x, y)] && g.levelBase(x, y) === 0 && g.zoneCfg(x, y) && !g.zoneCfg(x, y).outside; if (okc) { if (!run) x0 = x; run++; } else { if (run >= 20 && (!best || run > best.n)) best = { y, x0, n: run }; run = 0; } } }
  const z = g.cz(best.y), cxAt = (i) => g.cx(best.x0 + i), cellOf = (wx) => Math.round((wx - cxAt(0)) / (cxAt(1) - cxAt(0)));
  const saved = [];
  const light = (from, to) => {                                  // luz 0,9 nas celulas [from,to] (todas as fileiras: o corredor tem mais de uma de largura)
    for (const [idx, v] of saved.splice(0)) g.light[idx] = v;
    for (let i = 0; i < best.n; i++) for (let dy = -4; dy <= 4; dy++) { const idx = g.idx(best.x0 + i, best.y + dy); saved.push([idx, g.light[idx]]); g.light[idx] = i >= from && i <= to ? 0.9 : 0; }
    match.lighting.lightAt = (wx) => { const i = cellOf(wx); return i >= from && i <= to ? 0.9 : 0; };
  };
  const place = (ci, pi, state) => {
    ai.hardReset(); ai.activate({ x: cxAt(ci), z }); ai.firstWalk = false; ai.goal = null; ai.stateT = 5; ai.aggr = 1; ai.pauseT = 0; ai.burstCD = 999;   // sem lampada estourando: so o comportamento da luz
    ai.pos.set(cxAt(ci), g.floorY(cxAt(ci), z), z); ai.yaw = Math.PI / 2; ai.meter = 0; ai.tgt = null; ai._tp = null;
    pA.pos.set(cxAt(pi), g.floorY(cxAt(pi), z), z); pA.updateEye();
    ai.setState(state);
    if (state === 'chase') { ai.tgt = ai.nearestView(); ai.knowT = 5; ai.lastSeen.copy(pA.pos); ai.stateT = 0.5; ai.meter = 1.2; }
  };
  return { match, ai, g, m, pA, best, z, cxAt, cellOf, light, place };
};
await section('Luz forte: encara sem virar de costas, nao persegue por dentro da luz, encostar mata', async () => {
  const dt = 1 / 20;
  let { match, ai, g, m, pA, z, cxAt, cellOf, light, place, best } = await rigLight();
  // 1) vem do escuro para um jogador na luz: para na borda, encara (sem o clipe 'look', que gira o quadril ~170 graus) e depois sai
  light(6, 14); place(0, 10, 'chase');
  const clips = new Set(); let hesT = 0, enteredLit = false, fled = false, maxOff = 0;
  for (let i = 0; i < 20 * 25; i++) {
    if (ai.state === 'chase') ai.knowT = Math.max(ai.knowT, 1);
    match.tick(dt);
    if ((ai.state === 'chase' || ai.state === 'hesitate') && ai.lightHere() > 0.85) enteredLit = true;
    if (ai.state === 'hesitate') { hesT += dt; clips.add(m.current); maxOff = Math.max(maxOff, Math.abs(angleDiff(ai.yaw, Math.atan2(pA.pos.x - ai.pos.x, pA.pos.z - ai.pos.z)))); }
    if (ai.state === 'flee') fled = true;
  }
  ok(!enteredLit, 'caca: nao entra no corredor aceso (para na borda)');
  ok(hesT > 3 && !clips.has('look'), `encarando na borda (${hesT.toFixed(1)} s) sem o clipe que vira o corpo (clipes usados: ${[...clips].join(', ')})`);
  ok(maxOff < 0.6, `fica de frente para o jogador enquanto encara (desvio maximo ${(maxOff * 57.3).toFixed(0)} graus)`);
  ok(fled, 'depois de observar, vira e sai (fuga)');
  // 2) ja DENTRO da luz (acendeu com ela ali / saiu de um duto) e o jogador tambem na luz: nao persegue nem pega
  ({ match, ai, g, m, pA, z, cxAt, cellOf, light, place, best } = await rigLight());
  light(6, 14); place(7, 12, 'chase');
  let attacked = false;
  for (let i = 0; i < 20 * 8; i++) { if (ai.state === 'chase') ai.knowT = Math.max(ai.knowT, 1); match.tick(dt); if (ai.state === 'attack') attacked = true; }
  ok(!attacked && ai.state === 'hesitate', `dentro da luz forte com o jogador tambem na luz: nao pega (estado ${ai.state})`);
  // 3) jogador no ESCURO e ela na luz: a caca continua normal (so a luz forte protege)
  ({ match, ai, g, m, pA, z, cxAt, cellOf, light, place, best } = await rigLight());
  light(6, 14); place(7, 2, 'chase');
  let caught = false;
  for (let i = 0; i < 20 * 8 && !caught; i++) { if (ai.state === 'chase') ai.knowT = Math.max(ai.knowT, 1); match.tick(dt); if (ai.state === 'attack') caught = true; }
  ok(caught, 'jogador no escuro (e ela na luz): a caca nao e travada');
  // 4) ENCOSTAR nela dentro da luz mata: a luz forte so a segura de longe (antes, parada na borda da luz, nada acontecia ao encostar)
  ({ match, ai, g, m, pA, z, cxAt, cellOf, light, place, best } = await rigLight());
  light(6, 14); place(7, 8, 'hesitate');                          // 1 celula (1,25 m) de distancia: dentro do alcance do bote (1,15 m) com o corpo dela
  ai.pos.x = cxAt(7); pA.pos.x = cxAt(7) + 1.0; pA.updateEye(); ai.tgt = ai.nearestView(); ai.knowT = 5; ai.stateT = 0.5;
  let touchedKill = false;
  for (let i = 0; i < 20 * 3 && !touchedKill; i++) { match.tick(dt); if (ai.state === 'attack') touchedKill = true; }
  ok(touchedKill, 'jogador encostou nela dentro da luz forte: ela ataca');
  ({ match, ai, g, m, pA, z, cxAt, cellOf, light, place, best } = await rigLight());
  light(6, 14); place(7, 11, 'hesitate');                         // 4 celulas (5 m): longe, a luz segura
  let farAttack = false;
  for (let i = 0; i < 20 * 3; i++) { match.tick(dt); if (ai.state === 'attack') farAttack = true; }
  ok(!farAttack, 'jogador a 5 m dela dentro da luz forte: continua protegido');
});

// ---------------------------------------------------------------------------
await section('Sem dutos: ela e grande demais, nunca entra num duto, mesmo quando mandada embora ou para outro andar', async () => {
  const dt = 1 / 20;
  const { bots: [A, B], match } = await makeMatch(ctx, 2);
  const ai = match.ai, g = match.grid, pA = match.players.get(A.id), pB = match.players.get(B.id);
  ok(typeof ai.ventTo === 'undefined' && typeof ai.uVent === 'undefined', 'a funcao de entrar no duto foi removida da IA');
  match._wakeCreature(); ai.hardReset(); ai.activate(match.world.creatureSpawn); ai.firstWalk = false; match.freezeAI = false;
  // respiro do diretor: ela ANDA ate um canto longe dos jogadores (antes sumia por um duto)
  const sp = match.world.playerStart;
  for (const p of [pA, pB]) { p.pos.set(sp.x, g.floorY(sp.x, sp.z), sp.z); p.updateEye(); }
  const from = { x: ai.pos.x, z: ai.pos.z };
  const went = ai.retreat(30);
  ok(went === true && ai.state === 'patrol' && ai.path.length > 0, `respiro: ela anda pelo chao ate um canto longe (estado ${ai.state}, ${ai.path.length} pontos)`);
  let seenVent = false, maxJump = 0, last = { x: ai.pos.x, z: ai.pos.z }, farthest = 0;
  for (let i = 0; i < 20 * 120; i++) {
    match.tick(dt);
    if (ai.state === 'vent') seenVent = true;
    maxJump = Math.max(maxJump, Math.hypot(ai.pos.x - last.x, ai.pos.z - last.z)); last = { x: ai.pos.x, z: ai.pos.z };
    farthest = Math.max(farthest, Math.hypot(ai.pos.x - sp.x, ai.pos.z - sp.z));
  }
  ok(!seenVent, 'em 2 minutos de jogo ela nunca entrou em estado de duto');
  ok(maxJump < 0.5, `nunca some e reaparece (maior deslocamento num passo: ${maxJump.toFixed(2)} m)`);
  ok(farthest > 15, `ela se afastou de verdade dos jogadores (${farthest.toFixed(0)} m)`);
  // alvo em OUTRO andar: ela vai a pe pela escada (antes entrava num duto). A porta do subsolo trancada continua barrando a criatura.
  const M2 = await makeMatch(ctx, 2);                      // partida nova: nos 2 minutos acima ela pode ter pego os jogadores
  const ai2 = M2.match.ai, pA2 = M2.match.players.get(M2.bots[0].id);
  for (const d of M2.match.world.doors) if (d.kind === 'K') d.locked = false;
  M2.match._wakeCreature(); ai2.hardReset(); ai2.activate(M2.match.world.creatureSpawn); ai2.firstWalk = false;
  const down = M2.match.world.itemDefs.find(i => i.type === 'fuse' && i.y < -1) || M2.match.world.itemDefs.find(i => i.y < -1);
  const tgt = new THREE.Vector3(down.x, down.y, down.z);
  pA2.pos.copy(tgt); pA2.updateEye();
  ai2.setState('patrol'); ai2.goal = tgt.clone(); ai2.firstWalk = true; ai2.pauseT = 0; ai2._arrived = false;
  let reached = false, vent2 = false;
  for (let i = 0; i < 20 * 240 && !reached; i++) {
    M2.match.tick(dt); if (ai2.state === 'vent') vent2 = true;
    if (ai2.pos.y < -3 && Math.hypot(ai2.pos.x - tgt.x, ai2.pos.z - tgt.z) < 6) reached = true;
  }
  ok(reached && !vent2, 'destino no subsolo: ela desce a pe pela escada, sem duto');
});

console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
await ctx.stop();
process.exit(T.fail ? 1 : 0);
