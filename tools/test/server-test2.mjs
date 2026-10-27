// Testes do servidor, parte 2: morte, fusiveis caidos, espectadores, fantasma, voz, desconexao, vitoria, nova rodada.
// Uso: node tools/test/server-test2.mjs
import { COOP } from '../../src/shared/coop.js';
import { PLAYER } from '../../src/config.js';
import { ok, section, T, startHub, makeMatch, standNear, item, sleep } from './harness.mjs';
import { Bot } from './bot.mjs';
import { ORIGIN } from './harness.mjs';

const ctx = await startHub();

// ---------------------------------------------------------------------------
await section('Morte: fusiveis caem em lugar acessivel, sem duplicar; morto nao interage', async () => {
  const { bots: [A, B, C], match, room } = await makeMatch(ctx, 3);
  const pA = match.players.get(A.id), pB = match.players.get(B.id);
  const f1 = item(match, 'fuse:1'), f2 = item(match, 'fuse:2');
  standNear(match, pA, f1.x, f1.z); A.send({ t: 'take', key: 'fuse:1' }); await sleep(60);
  standNear(match, pA, f2.x, f2.z); A.send({ t: 'take', key: 'fuse:2' }); await sleep(60);
  ok(pA.carry.size === 2, 'A carrega 2 fusiveis');
  const deathPos = { x: pA.pos.x, z: pA.pos.z };
  match._kill(pA); await sleep(80);
  const dead = await B.next((m) => m.t === 'dead' && m.id === A.id);
  ok(dead.drops.length === 2 && dead.drops.map(d => d.key).sort().join() === 'fuse:1,fuse:2', 'fusiveis carregados caem com o morto (mesmas identidades)');
  const g = match.grid;
  let allGood = true;
  for (const d of dead.drops) {
    const near = Math.hypot(d.x - deathPos.x, d.z - deathPos.z) <= 3.2;
    const [qx, qz] = g.collideCircle(d.x, d.z, PLAYER.radius);
    const free = Math.hypot(qx - d.x, qz - d.z) < 0.03;
    const cx = g.cellX(d.x), cy = g.cellY(d.z);
    allGood = allGood && near && free && g.isFloor(cx, cy) && !g.navBlock[g.idx(cx, cy)];
  }
  ok(allGood, 'fusiveis caidos ficam a <= 3,2 m da morte, em piso livre (sem parede/movel)');
  ok(match.items.get('fuse:1').state === 'world' && match.items.get('fuse:2').state === 'world' && pA.carry.size === 0, 'estado oficial: itens de volta ao mundo, morto sem nada');
  ok([...match.items.keys()].filter(k => k.startsWith('fuse:')).length === 7, 'continuam existindo exatamente 7 fusiveis');
  // sobrevivente pega o fusivel caido
  const d0 = dead.drops[0];
  standNear(match, pB, d0.x, d0.z, 0.4, 1.4); B.send({ t: 'take', key: d0.key }); await sleep(80);
  ok(pB.carry.has(d0.key) && match.items.get(d0.key).by === B.id, 'sobrevivente consegue pegar o fusivel caido (mesmo item)');
  // morto nao interage
  for (const [msg, nm] of [[{ t: 'take', key: 'fuse:3' }, 'coletar'], [{ t: 'install' }, 'instalar'], [{ t: 'door', id: 0, open: true }, 'abrir porta'], [{ t: 'hide', spot: 0, on: true }, 'esconder'], [{ t: 'drawer', num: 13, open: true }, 'gaveta']]) {
    A.drop('deny'); A.send(msg); const d = await A.next('deny'); ok(d.reason === 'dead', `espectador nao pode ${nm}`);
  }
  // espirito invisivel para os vivos, mas ve os vivos
  A.sendState({ pos: { x: pA.pos.x, y: pA.pos.y, z: pA.pos.z } }); B.sendState({ pos: { x: pB.pos.x, y: pB.pos.y, z: pB.pos.z } });
  await sleep(300);
  const snapB = B.snap, snapA = A.snap;
  ok(snapB && !snapB.p.some(e => e[0] === A.id), 'o espirito NAO aparece nos snapshots dos vivos');
  ok(snapA && snapA.p.some(e => e[0] === B.id), 'o espirito ve os vivos');
  // espirito nao sai do predio
  A.pos = { x: -50, y: 0, z: -50, yaw: 0, pitch: 0 }; A.sendState(); await sleep(100);
  ok(await A.tryNext('corr', 300), 'espirito fora do mapa e reposicionado');
  const [qx, qz] = g.collideCircle(pA.pos.x, pA.pos.z, PLAYER.radius, { ignore: (b) => b.door && b.door.kind !== 'X' });
  ok(g.isFloor(g.cellX(pA.pos.x), g.cellY(pA.pos.z)) || g.isDoor(g.cellX(pA.pos.x), g.cellY(pA.pos.z)), 'espirito continua dentro do piso valido');
  // espirito nao bloqueia: nao esta no conjunto de alvos da criatura nem de colisao (nao ha caixa para ele)
  ok(match.ai.aliveViews().every(v => v.id !== A.id), 'criatura ignora o espirito (nao e alvo)');
});

await section('Aparicao do fantasma: ~1 s, intervalo 45-90 s, controlada pelo servidor', async () => {
  const { bots: [A, B], match } = await makeMatch(ctx, 2);
  const pA = match.players.get(A.id), pB = match.players.get(B.id);
  match._kill(pA); await sleep(60);
  ok(pA.ghostT >= COOP.ghost.min && pA.ghostT <= COOP.ghost.max, `primeiro intervalo do espirito sorteado em [${COOP.ghost.min},${COOP.ghost.max}] s (${pA.ghostT.toFixed(1)})`);
  let mn = 999, mx = 0; for (let i = 0; i < 400; i++) { const v = match._nextGhostBase(); mn = Math.min(mn, v); mx = Math.max(mx, v); }
  ok(mn >= 45 && mx <= 90, `sorteios ficam entre 45 e 90 s (min ${mn.toFixed(1)}, max ${mx.toFixed(1)})`);
  B.drop('ghost'); pA.ghostT = 0.01;
  for (let i = 0; i < 3; i++) match.tick(0.05);
  const gh = await B.next('ghost');
  ok(gh.dur === 1 && Object.keys(gh).sort().join() === 'dur,t,x,y,yaw,z', 'aparicao dura 1 s e nao carrega identidade do morto');
  const dist = Math.hypot(gh.x - pB.pos.x, gh.z - pB.pos.z);
  ok(dist >= COOP.ghost.minDist - 0.01 && dist <= COOP.ghost.maxDist + 0.01, `aparece entre ${COOP.ghost.minDist} e ${COOP.ghost.maxDist} m do vivo (${dist.toFixed(1)} m)`);
  ok(pA.ghostT >= COOP.ghost.min, 'proxima aparicao reagendada dentro do intervalo');
  // o morto nao consegue acionar/posicionar: nenhuma mensagem do cliente faz isso
  A.drop('err'); A.send({ t: 'ghost', x: 5, z: 5 }); const e = await A.next('err'); ok(e.code === 'bad_msg', 'cliente nao tem comando para acionar a aparicao');
  B.drop('ghost'); pA.ghostT = 40; for (let i = 0; i < 40; i++) match.tick(0.05);   // 2 s: nada de aparicao fora do sorteio
  ok(!(await B.tryNext('ghost', 200)), 'sem aparicao antes do tempo sorteado');
});

await section('Voz: bloqueio entre mortos e vivos (inclusive apos reconexao)', async () => {
  const { bots: [A, B, C], match, room } = await makeMatch(ctx, 3);
  const [pA, pB, pC] = [A, B, C].map(b => match.players.get(b.id));
  ok(room.canVoice(pA, pB) && room.canVoice(pB, pC), 'vivos podem falar com vivos');
  A.send({ t: 'voice', to: B.id, data: { sdp: 'x' } }); const v1 = await B.next('voice'); ok(v1.from === A.id, 'sinalizacao entre vivos e repassada');
  match._kill(pA); await sleep(60);
  ok(!room.canVoice(pA, pB) && !room.canVoice(pB, pA), 'morto x vivo bloqueado nos dois sentidos');
  B.drop('voice'); A.send({ t: 'voice', to: B.id, data: { sdp: 'y' } }); B.send({ t: 'voice', to: A.id, data: { sdp: 'z' } });
  await sleep(150);
  ok(!B.peek('voice').length && !A.peek('voice').length, 'o servidor NAO repassa sinalizacao entre morto e vivo');
  // reconecta o morto
  A.terminate(); await sleep(100);
  const A2 = await ctx.bot('Ana', { token: A.token });
  ok(A2.welcome.resumed && A2.id === A.id, 'reconectou com o mesmo personagem');
  const sy = await A2.next('sync'); ok(sy.status === 'dead', 'apos reconectar continua morto (sem vida extra)');
  A2.send({ t: 'voice', to: B.id, data: { sdp: 'w' } }); await sleep(150);
  ok(!B.peek('voice').length, 'apos reconectar, o morto continua sem canal de voz com os vivos');
  // mortos entre si
  match._kill(pB); await sleep(60);
  ok(room.canVoice(pA, pB), 'espiritos podem conversar entre si');
  ok(!room.canVoice(pB, pC) && !room.canVoice(pA, pC), 'e continuam sem falar com o vivo restante');
});

await section('Desconexao: reconexao dentro da janela, saida definitiva libera fusiveis', async () => {
  const { bots: [A, B, C], match, room } = await makeMatch(ctx, 3);
  const [pA, pB, pC] = [A, B, C].map(b => match.players.get(b.id));
  const f3 = item(match, 'fuse:3'); standNear(match, pB, f3.x, f3.z); B.send({ t: 'take', key: 'fuse:3' }); await sleep(60);
  ok(pB.carry.has('fuse:3'), 'B carrega o fusivel 3');
  B.terminate(); await sleep(100);
  ok(!pB.connected && pB.status === 'alive', 'desconectado continua no jogo (mesmo estado)');
  const net = await A.next((m) => m.t === 'net' && m.id === B.id); ok(net.online === false, 'os outros sao avisados da queda');
  const B2 = await ctx.bot('Beto', { token: B.token });
  const sy = await B2.next('sync');
  ok(B2.welcome.resumed && sy.status === 'alive' && sy.carry.includes('fuse:3'), 'reconectou no mesmo personagem e estado (ainda carrega o fusivel)');
  ok(Math.abs(sy.pose.x - pB.pos.x) < 0.002 && Math.abs(sy.pose.z - pB.pos.z) < 0.002, 'volta na mesma posicao');
  // saida definitiva: estoura a janela
  B2.terminate(); await sleep(100);
  const dropsBefore = pB.carry.size;
  pB.offlineAt = match.time - COOP.reconnectGrace - 1; match.tick(0.05);
  ok(pB.status === 'left', 'fora da janela de reconexao o jogador sai de vez');
  const left = await A.next((m) => m.t === 'left' && m.id === B.id);
  ok(dropsBefore === 1 && left.drops.length === 1 && left.drops[0].key === 'fuse:3', 'fusivel que ele carregava foi liberado');
  ok(match.items.get('fuse:3').state === 'world' && !match.aliveList().includes(pB), 'fusivel acessivel de novo e lista de sobreviventes atualizada');
  const d = left.drops[0]; const g = match.grid; const [qx, qz] = g.collideCircle(d.x, d.z, PLAYER.radius);
  ok(Math.hypot(qx - d.x, qz - d.z) < 0.03 && g.isFloor(g.cellX(d.x), g.cellY(d.z)), 'e ficou em piso livre');
  // volta depois da janela: so como espectador
  const B3 = await ctx.bot('Beto', { token: B.token });
  const s3 = await B3.next('sync'); ok(s3.status === 'dead', 'quem volta depois de sair de vez entra como espectador (sem vida extra)');
});

await section('Anfitriao sai: controle do lobby e partida preservados', async () => {
  const { bots: [A, B, C], match, room } = await makeMatch(ctx, 3);
  ok(room.hostId === A.id, 'A e o anfitriao');
  A.terminate(); await sleep(120);
  ok(room.hostId === B.id && room.phase === 'playing' && !!room.match, 'anfitriao caiu: o controle passa ao mais antigo conectado e a partida continua');
  const h = await C.next('host'); ok(h.id === B.id, 'todos sao avisados do novo anfitriao');
  // A sai de vez por 'leave' (novo cliente)
  B.send({ t: 'leave' }); await B.next('left_room'); await sleep(80);
  ok(room.hostId === C.id, 'quando o novo anfitriao sai, passa adiante');
  ok(match.players.get(B.id).status === 'left', 'quem sai da sala durante a partida deixa o jogo (fusiveis liberados)');
});

await section('Todos morrem: derrota e nova rodada com tudo restaurado', async () => {
  const { bots: [A, B], match, room, code } = await makeMatch(ctx, 2);
  const pA = match.players.get(A.id), pB = match.players.get(B.id);
  const f4 = item(match, 'fuse:2'); standNear(match, pA, f4.x, f4.z); A.send({ t: 'take', key: 'fuse:2' }); await sleep(60);
  const pn = match.world.panel; standNear(match, pA, pn.x, pn.z - 1.0, 0, 0.5); A.send({ t: 'install' }); await sleep(80);
  ok(match.installed.length === 1, 'um fusivel instalado antes de morrerem');
  match._kill(pA); match._kill(pB);
  const end = await A.next('end', 2000);
  ok(end.result === 'lose', 'todos mortos: derrota');
  await sleep(80);
  ok(room.phase === 'lobby' && !room.match, 'a sala volta ao lobby');
  B.send({ t: 'ready', on: true }); await sleep(60);
  A.drop('room'); A.send({ t: 'start' });
  await Promise.all([A.next('sync', 3000), B.next('sync', 3000)]);
  const m2 = room.match;
  ok(m2 && m2 !== match, 'nova partida criada');
  ok([...m2.players.values()].every(p => p.status === 'alive' && p.carry.size === 0), 'todos vivos de novo, sem itens');
  ok(m2.installed.length === 0 && [...m2.items.values()].every(i => i.state === 'world' && i.pos.x === item(m2, i.key).x) && m2.lighting.powered.size === 1, 'fusiveis, quadro e luzes restaurados');
  ok(m2.ai.state === 'dormant' && !m2.exitOpen, 'criatura adormecida e saida trancada');
});

await section('Reuniao final, 7 fusiveis, saida validada no servidor e vitoria', async () => {
  const { bots: [A, B, C], match, room } = await makeMatch(ctx, 3);
  const [pA, pB, pC] = [A, B, C].map(b => match.players.get(b.id));
  const pn = match.world.panel;
  // A pega todos os fusiveis (teleporte de servidor so para o teste)
  for (let i = 1; i <= 7; i++) { const f = item(match, 'fuse:' + i); standNear(match, pA, f.x, f.z, 0, 1.4); if (f.drawer) { A.send({ t: 'drawer', num: f.drawer, open: true }); await sleep(40); } A.send({ t: 'take', key: 'fuse:' + i }); await sleep(30); }
  ok(pA.carry.size === 7, 'A carrega os 7 fusiveis (' + pA.carry.size + ')');
  // instala com todos longe: os 6 primeiros entram; o 7o exige reuniao
  standNear(match, pA, pn.x, pn.z - 1.0, 0, 0.5); standNear(match, pB, 33, 10); standNear(match, pC, 45, 15);
  A.drop('deny'); A.send({ t: 'install' });
  const deny = await A.next('deny');
  ok(deny.reason === 'gather' && deny.missing.includes('Beto') && deny.missing.includes('Cida'), '7o fusivel recusado: indica quem falta na area de reuniao');
  ok(match.installed.length === 6 && pA.carry.size === 1 && !match.exitOpen, 'os 6 primeiros entraram, o 7o continua com A e a saida segue trancada');
  // saida trancada: cruzar o gatilho nao vale
  const ex = match.world.exitTrigger; standNear(match, pC, ex.x, ex.z + 1.0, 0, 1.0); C.sendState({ pos: { x: pC.pos.x, y: pC.pos.y, z: pC.pos.z } }); await sleep(100);
  ok(pC.status === 'alive', 'atravessar a saida antes dos 7 fusiveis nao vence');
  // reuniao
  standNear(match, pB, match.meet.x, match.meet.z, 0, 1.2); standNear(match, pC, match.meet.x + 0.6, match.meet.z, 0, 1.2);
  ok(match.missingAtMeeting().length === 0, 'todos os vivos na area de reuniao');
  // um morto nao conta como faltante
  A.send({ t: 'install' }); await sleep(120);
  ok(match.installed.length === 7 && match.exitOpen && match.world.exitDoor.isOpen(), 'com todos reunidos o 7o entra e a porta de saida destrava para todos');
  const un = await B.next('unlock'); ok(!!un, 'todos recebem o desbloqueio');
  ok(match.ai.state !== 'dormant' && match.ai.enraged && match.lighting.blackout, 'final: apagao e criatura enfurecida');
  // corre para fora, um a um
  for (const [b, p] of [[A, pA], [B, pB]]) { standNear(match, p, ex.x, ex.z + 0.2, 0, 0.8); p.pos.z = ex.z + 0.3; p.updateEye(); b.sendState({ pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } }); await sleep(120); }
  ok(pA.status === 'escaped' && pB.status === 'escaped', 'sobreviventes que cruzam a saida escapam (validado no servidor)');
  ok(room.match && room.match.phase !== 'ended', 'a partida ainda espera o ultimo vivo');
  match._kill(pC);
  const end = await A.next('end', 2000);
  ok(end.result === 'win' && end.stats.escaped === 2, 'ultimo vivo morre: vitoria (2 escaparam)');
});

await section('Gather ignora mortos', async () => {
  const { bots: [A, B, C], match } = await makeMatch(ctx, 3);
  const [pA, pB, pC] = [A, B, C].map(b => match.players.get(b.id));
  match._kill(pC);
  standNear(match, pA, match.meet.x, match.meet.z, 0, 1.2); standNear(match, pB, match.meet.x + 0.5, match.meet.z, 0, 1.2);
  ok(match.missingAtMeeting().length === 0, 'morto nao e exigido na area de reuniao');
  pB.pos.set(40, 0, 10); pB.updateEye();
  ok(match.missingAtMeeting().map(p => p.name).join() === 'Beto', 'vivo fora da area aparece como faltando');
});

await section('Entrada tardia, reconexao e reinicio do servidor', async () => {
  const { bots: [A, B], match, room, code } = await makeMatch(ctx, 2);
  const E = await ctx.bot('Eva'); E.send({ t: 'join', code });
  const eStart = await E.next('start'), eSync = await E.next('sync');
  ok(eSync.status === 'dead' && eSync.players.find(q => q.id === E.id)?.watcher === true, 'quem entra numa partida em andamento vira espectador (espirito), nunca ganha vida nova');
  ok(match.players.get(E.id).watcher && match.aliveList().length === 2 && eStart.players.length === 3, 'o espectador nao conta como jogador vivo');
  const F = await ctx.bot('Fulano', { token: 'token-de-sessao-antiga-que-o-servidor-nao-conhece' });
  ok(F.welcome.expired === true && F.welcome.resumed === false, 'token desconhecido (servidor reiniciou): cliente e avisado com expired=true');
  // A sai da sala e volta depois: entra de novo, mas so como espectador
  A.send({ t: 'leave' }); await A.next('left_room');
  A.drop((m) => m.t === 'room'); A.send({ t: 'join', code }); const rA = await A.next('room');
  ok(rA.members.find(m => m.id === A.id)?.role === 'spectator', 'quem saiu e volta durante a partida entra como espectador');
});

await section('Movimento: velocidade aceita e velocidade absurda', async () => {
  const { bots: [A], match } = await makeMatch(ctx, 1);
  const pA = match.players.get(A.id);
  const start = { x: pA.pos.x, z: pA.pos.z };
  // caminha 3 s a 4,9 m/s (correr) em passos de 15 Hz para o norte, se houver espaco livre
  let x = pA.pos.x, z = pA.pos.z, moved = 0;
  const step = 4.9 / 15;
  for (let i = 0; i < 20; i++) {
    const nz = z - step; const [cx, cz] = match.grid.collideCircle(x, nz, PLAYER.radius);
    if (Math.abs(cz - nz) > 0.01) break;
    z = nz; A.sendState({ pos: { x, y: pA.pos.y, z, yaw: 0, pitch: 0 }, msg: { mv: 3 } });
    match.time += 1 / 15; await sleep(3);
  }
  ok(Math.hypot(pA.pos.x - start.x, pA.pos.z - start.z) > 1.0, 'corrida normal e aceita');
  // teleporte em rajada: 40 mensagens de +3 m
  const before = { x: pA.pos.x, z: pA.pos.z };
  for (let i = 0; i < 40; i++) { A.sendState({ pos: { x: before.x + 3 * (i + 1), y: pA.pos.y, z: before.z, yaw: 0, pitch: 0 } }); }
  await sleep(200);
  ok(Math.hypot(pA.pos.x - before.x, pA.pos.z - before.z) < 3, 'rajada de mensagens nao vira velocidade extra (orcamento de movimento)');
});

await section('Limite de mensagens e mensagens invalidas', async () => {
  const b = await ctx.bot('Spam');
  for (let i = 0; i < 2000; i++) b.send({ t: 'ping', ts: i });
  await sleep(300);
  ok(b.msgs.filter(m => m.t === 'pong').length < 1000, 'excesso de mensagens e descartado (rate limit)');
  const c = await ctx.bot('Lixo');
  c.ws.send('isto nao e json'); const e1 = await c.next('err'); ok(e1.code === 'bad_msg', 'JSON invalido nao derruba o servidor');
  c.ws.send(JSON.stringify({ t: 'take', key: 1 })); await sleep(100);
  ok(ctx.hub.conns.size > 0, 'servidor continua no ar');
});

await section('Criatura com 2 jogadores: alvo unico, botes, fumaca e queimadura sem somar', async () => {
  const { bots: [A, B], match } = await makeMatch(ctx, 2);
  const [pA, pB] = [A, B].map(b => match.players.get(b.id));
  const ai = match.ai, g = match.grid;
  const cz = 11 * 1.25;                       // centro do Corredor Norte (2 celulas de largura, linha de visao livre)
  const cx0 = g.cx(8);
  const place = (p, x, z) => { p.pos.set(x, g.floorY(x, z), z); p.updateEye(); };
  const freshCreature = (x) => { ai.hardReset(); ai.activate(match.world.creatureSpawn); ai.stateT = 0; ai.firstWalk = false; ai.pos.set(x, 0, cz); ai.m.group.position.copy(ai.pos); ai.setState('lurk'); ai.lurkTime = 999; ai.exposure = 0; ai.habit = 0; };
  const noPerceive = () => { ai.perceive = function () { this.sees = false; }; };
  const aim = (p, h) => { const dx = h.x - p.eye.x, dy = h.y - (p.eye.y - 0.2), dz = h.z - p.eye.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  const run = (nBeams) => {
    freshCreature(cx0); noPerceive(); ai.yaw = Math.PI / 2; ai.m.group.rotation.y = ai.yaw;
    place(pA, cx0 + 6, cz - 0.3); place(pB, cx0 + 6.4, cz + 0.4);
    const h = ai.m.headWorld(new (pA.eye.constructor)());
    [pA, pB].forEach((p, i) => { p.fl.on = i < nBeams; p.fl.focus = 1; aim(p, h); });
    ai.checkFlashlight(0.05); ai.checkFlashlight(0.05);
    return { exp: ai.exposure, burning: ai.burning };
  };
  const one = run(1), two = run(2);
  ok(one.burning && one.exp > 0.05, 'um feixe no rosto queima (exposicao ' + one.exp.toFixed(3) + ')');
  ok(Math.abs(two.exp - one.exp) < 1e-6, 'dois feixes no rosto NAO somam: mesma exposicao do solo (' + two.exp.toFixed(3) + ' x ' + one.exp.toFixed(3) + ')');
  // bote: criatura colada em A em perseguicao -> A morre; B segue vivo e a criatura procura em vez de ficar parada
  delete ai.perceive;
  freshCreature(cx0 + 5); place(pA, cx0 + 6.0, cz - 0.3); place(pB, g.cx(52), g.cz(20)); pA.fl.on = false; pB.fl.on = false;
  ai.setState('chase'); ai.stateT = 0.1; ai.knowT = 5; ai.tgt = pA.view; ai.yaw = Math.PI / 2; ai.m.group.rotation.y = ai.yaw;
  for (let i = 0; i < 160 && pA.status === 'alive'; i++) match.tick(0.05);
  ok(pA.status === 'dead' && pB.status === 'alive', 'a criatura pega um jogador; o outro segue vivo (estado ' + ai.state + ')');
  const cm = await A.tryNext('caught', 200);
  ok(!!cm, 'a vitima recebe o aviso de que foi pega (animacao de morte)');
  for (let i = 0; i < 60; i++) match.tick(0.05);
  ok(ai.state !== 'attack', 'depois do bote a criatura volta a cacar (estado ' + ai.state + ')');
});

console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
await ctx.stop();
process.exit(T.fail ? 1 : 0);
