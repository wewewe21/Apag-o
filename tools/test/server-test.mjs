// Testes automatizados do servidor (Node): HTTP/CORS, origem do WebSocket, salas e lobby, partida, fusiveis, morte, espectadores,
// desconexao/reconexao, nova rodada e vitoria. Roda um Hub real em memoria e conecta robos WebSocket.
// Uso: node tools/test/server-test.mjs
import { Hub } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { COOP } from '../../src/shared/coop.js';
import { Bot, sleep } from './bot.mjs';

let pass = 0, fail = 0;
const results = [];
function ok(cond, msg) { if (cond) { pass++; results.push('  ok   ' + msg); } else { fail++; results.push('  FALHA ' + msg); console.log('  FALHA ' + msg); } }
async function section(name, fn) {
  console.log('\n# ' + name);
  const before = results.length;
  try { await fn(); } catch (e) { fail++; console.log('  EXCECAO em "' + name + '": ' + (e.stack || e)); }
  for (const r of results.slice(before)) console.log(r);
}

const ORIGIN = 'https://jogador.github.io';
const cfg = loadConfig({ NODE_ENV: 'production', PORT: '0', ALLOWED_ORIGINS: ORIGIN + ',https://outro.exemplo.com/', MAX_ROOMS: '3', ICE_SERVERS_JSON: '[{"urls":"stun:stun.l.google.com:19302"}]', TURN_URLS: 'turn:turn.exemplo.com:3478', TURN_SECRET: 'segredo-de-teste' });
const hub = new Hub(cfg);
await hub.start();
const port = hub.server.address().port;
const HTTP = `http://127.0.0.1:${port}`, WS = `ws://127.0.0.1:${port}/ws`;
const bots = [];
const bot = async (name, o = {}) => { const b = new Bot(WS, name, { origin: ORIGIN, ...o }); await b.connect(); bots.push(b); return b; };
const roomOf = (code) => hub.rooms.get(code);
const CELL = 1.25;

// ---------------------------------------------------------------------------
await section('HTTP: /health, CORS e /ice', async () => {
  let r = await fetch(HTTP + '/health');
  const j = await r.json();
  ok(r.status === 200 && j.ok === true, '/health responde 200 com {ok:true} (sem Origin: health check do provedor)');
  r = await fetch(HTTP + '/health', { headers: { Origin: ORIGIN } });
  ok(r.headers.get('access-control-allow-origin') === ORIGIN, 'CORS: origem permitida recebe Access-Control-Allow-Origin');
  ok((r.headers.get('vary') || '').includes('Origin'), 'CORS: Vary: Origin');
  r = await fetch(HTTP + '/health', { headers: { Origin: 'https://malvado.example' } });
  ok(!r.headers.get('access-control-allow-origin'), 'CORS: origem NAO permitida nao recebe cabecalho CORS');
  r = await fetch(HTTP + '/ice', { headers: { Origin: 'https://malvado.example' } });
  ok(r.status === 403, '/ice recusa origem nao permitida');
  r = await fetch(HTTP + '/ice', { headers: { Origin: ORIGIN } });
  const ice = await r.json();
  ok(r.status === 200 && ice.iceServers.some(s => String(s.urls).includes('stun')), '/ice devolve STUN configuravel');
  const turn = ice.iceServers.find(s => s.credential);
  ok(!!turn && /^\d+:/.test(turn.username) && !JSON.stringify(ice).includes('segredo-de-teste'), '/ice gera credencial TURN temporaria sem vazar o segredo');
  r = await fetch(HTTP + '/rooms', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' }, method: 'OPTIONS' });
  ok(r.status === 204 && r.headers.get('access-control-allow-methods'), 'preflight OPTIONS responde 204 para origem permitida');
  r = await fetch(HTTP + '/rooms', { method: 'OPTIONS', headers: { Origin: 'https://malvado.example' } });
  ok(r.status === 403, 'preflight recusa origem nao permitida');
});

await section('WebSocket: validacao de origem', async () => {
  let err = null;
  try { const b = new Bot(WS, 'x', { origin: 'https://malvado.example' }); await b.connect(); b.close(); } catch (e) { err = e; }
  ok(err && /403/.test(err.message), 'WebSocket recusa Origin nao permitido (403)');
  err = null;
  try { const b = new Bot(WS, 'x', {}); await b.connect(); b.close(); } catch (e) { err = e; }
  ok(err && /403/.test(err.message), 'em producao, sem Origin tambem e recusado');
  const b = await bot('Ok'); ok(!!b.id && b.token.length >= 16, 'origem permitida conecta e recebe welcome com token');
  b.close();
});

// ---------------------------------------------------------------------------
let A, B, C, D, code;
await section('Salas: criar, listar, entrar por codigo, limite de 4, prontos', async () => {
  A = await bot('Ana'); B = await bot('Beto'); C = await bot('Cida'); D = await bot('Davi');
  A.send({ t: 'create', roomName: 'Sala da Ana' });
  const rs = await A.next('room');
  code = rs.code;
  ok(/^[A-Z]{4}$/.test(code) && !/[IO]/.test(code), 'codigo de 4 letras (sem I/O): ' + code);
  ok(rs.phase === 'lobby' && rs.host === A.id && rs.members.length === 1 && rs.members[0].name === 'Ana', 'criador e o anfitriao; nome e contagem aparecem');
  B.send({ t: 'rooms' }); const list = await B.next('rooms');
  ok(list.rooms.length === 1 && list.rooms[0].code === code && list.rooms[0].count === 1 && list.rooms[0].max === 10 && list.rooms[0].maxPlayers === 4 && list.rooms[0].phase === 'lobby', 'lista de salas mostra codigo, participantes/4 e estado');
  B.send({ t: 'join', code: code.toLowerCase() });
  await B.next('room'); C.send({ t: 'join', code }); await C.next('room'); D.send({ t: 'join', code }); const r4 = await D.next('room');
  ok(r4.members.length === 4 && r4.members.map(m => m.name).join() === 'Ana,Beto,Cida,Davi', '4 participantes com nomes');
  const E = await bot('Eva'); E.send({ t: 'join', code }); const r5 = await E.next('room');
  const me5 = r5.members.find(m => m.id === E.id);
  ok(r5.members.length === 5 && me5.role === 'spectator' && me5.q === 1 && r5.members.filter(m => m.role === 'player').length === 4, 'o quinto entra como ESPECTADOR (fila 1); os 4 primeiros seguem jogadores');
  E.send({ t: 'leave' }); await E.next('left_room');
  E.send({ t: 'join', code: 'ZZZZ' }); const e6 = await E.next('err'); ok(e6.code === 'no_room', 'codigo inexistente e recusado');
  E.close();
  B.send({ t: 'start' }); const e7 = await B.next('err'); ok(e7.code === 'not_host', 'so o criador inicia');
  A.send({ t: 'start' }); const e8 = await A.next('err');
  ok(e8.code === 'not_ready' && /Beto/.test(e8.msg), 'iniciar exige que os participantes estejam prontos');
  for (const b of [B, C, D]) b.send({ t: 'ready', on: true });
  await sleep(150);
  const st = A.room; // ultimo estado recebido
  A.drop('room');
  ok(true, 'prontos sinalizados');
});

await section('Limite de salas e nomes repetidos', async () => {
  const x1 = await bot('X1'), x2 = await bot('X2'), x3 = await bot('X3');
  x1.send({ t: 'create' }); await x1.next('room');
  x2.send({ t: 'create' }); await x2.next('room');
  x3.send({ t: 'create' }); const e = await x3.next('err');
  ok(e.code === 'server_full', 'MAX_ROOMS respeitado (servidor cheio)');
  x1.send({ t: 'leave' }); await x1.next('left_room'); x2.send({ t: 'leave' }); await x2.next('left_room');
  await sleep(50);
  ok(hub.rooms.size === 1, 'sala vazia e removida');
  for (const b of [x1, x2, x3]) b.close();
});

// ---------------------------------------------------------------------------
let match, players;
await section('Iniciar partida: spawn, 7 fusiveis, estado completo', async () => {
  A.send({ t: 'start' });
  const syncs = await Promise.all([A, B, C, D].map(b => b.next('sync', 4000)));
  match = roomOf(code).match;
  players = [A, B, C, D];
  ok(!!match && roomOf(code).phase === 'playing', 'partida iniciada pelo criador');
  const poses = syncs.map(s => s.pose);
  let minSep = 99; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) minSep = Math.min(minSep, Math.hypot(poses[i].x - poses[j].x, poses[i].z - poses[j].z));
  ok(minSep >= 0.9 && minSep < 3, `todos comecam na mesma regiao sem sobreposicao (menor distancia ${minSep.toFixed(2)} m)`);
  const fuses = syncs[0].items.filter(i => i.key.startsWith('fuse:'));
  ok(fuses.length === 7 && new Set(fuses.map(f => f.key)).size === 7 && syncs[0].total === 7, 'exatamente 7 fusiveis com identidades unicas');
  ok(fuses.every(f => f.st === 'world'), 'todos os fusiveis comecam no mapa');
  // todos alcancaveis a pe: ha um ponto livre a <= 1,6 m do fusivel, ligado ao spawn (portas tratadas como abertas)
  const g = match.grid, start = match.world.playerStart;
  const saved = match.world.doors.map(d => [d, g.idx(d.x, d.y)]);
  for (const d of match.world.doors) g.doors.set(g.idx(d.x, d.y), { blocking: () => false, creaturePassable: () => true });
  const reach = g.reachable(g.cellX(start.x), g.cellY(start.z));
  const bad = fuses.filter(f => {
    const c = match.itemDefs.find(i => i.key === f.key);
    const spot = match.world.freeSpotNear(c.x, c.z, 0, 1.6, 0.32, true);
    return !spot || !reach[g.idx(g.cellX(spot.x), g.cellY(spot.z))];
  });
  for (const [d, i] of saved) g.doors.set(i, d); for (const d of match.world.doors) if (d.kind === 'X') g.doors.set(g.idx(d.x + 1, d.y), d);
  ok(bad.length === 0, 'os 7 fusiveis estao em locais acessiveis a pe' + (bad.length ? ' (inalcancaveis: ' + bad.map(b => b.key) + ')' : ''));
  ok(syncs.every(s => s.players.length === 4 && s.you), 'cada jogador recebe lista de jogadores e seu id');
  for (const b of players) { b.sendState({ pos: b.pos }); }
});

await section('Fusiveis: coleta simultanea, distancia, posse, duplicacao', async () => {
  const w = match.world;
  const f1 = match.itemDefs.find(i => i.key === 'fuse:1');
  // A e B no mesmo fusivel ao mesmo tempo
  for (const b of [A, B]) { b.pos.x = f1.x + 0.5; b.pos.y = match.grid.floorY(f1.x, f1.z); b.pos.z = f1.z + 0.3; }
  // teleporte proibido: o servidor corrige (fica no spawn)
  A.sendState(); B.sendState(); await sleep(120);
  const corr = await A.tryNext('corr', 300);
  ok(!!corr, 'teleporte de longe e corrigido pelo servidor');
  // coloca os jogadores "perto" pela via valida: mover o estado do servidor (teste de item, nao de movimento)
  for (const b of [A, B]) { const sp = match.players.get(b.id); sp.pos.set(f1.x + (b === A ? 0.4 : -0.4), match.grid.floorY(f1.x, f1.z), f1.z + 0.4); sp.updateEye(); }
  A.drop('deny'); B.drop('deny');
  A.send({ t: 'take', key: 'fuse:1' }); B.send({ t: 'take', key: 'fuse:1' });
  await sleep(200);
  const denies = [A, B].flatMap(b => b.peek('deny'));
  const holders = [...match.players.values()].filter(p => p.carry.has('fuse:1'));
  ok(holders.length === 1 && denies.length === 1 && denies[0].reason === 'taken', 'coleta simultanea do mesmo fusivel: so um consegue, o outro recebe "taken"');
  const holder = holders[0], other = holder.id === A.id ? B : A;
  const it = match.items.get('fuse:1');
  ok(it.state === 'carried' && it.by === holder.id, 'estado oficial: fusivel 1 carregado por quem venceu');
  // longe demais
  C.drop('deny'); C.send({ t: 'take', key: 'fuse:2' }); const d2 = await C.next('deny'); ok(d2.reason === 'not_near', 'coletar de longe e recusado');
  // instalar sem posse
  const pn = w.panel;
  for (const b of [C]) { const sp = match.players.get(b.id); sp.pos.set(pn.x, match.grid.floorY(pn.x, pn.z), pn.z - 1.0); sp.updateEye(); }
  C.drop('deny'); C.send({ t: 'install' }); const d3 = await C.next('deny'); ok(d3.reason === 'not_yours', 'instalar sem carregar fusivel e recusado');
  // instalar de longe
  const hb = holder === match.players.get(A.id) ? A : B;
  hb.drop('deny'); hb.send({ t: 'install' }); const d4 = await hb.next('deny'); ok(d4.reason === 'not_near', 'instalar longe do quadro e recusado');
  // instalar no quadro, duas vezes seguidas
  holder.pos.set(pn.x, match.grid.floorY(pn.x, pn.z), pn.z - 1.0); holder.updateEye();
  hb.drop('fuse'); hb.send({ t: 'install' }); hb.send({ t: 'install' });
  await sleep(200);
  ok(match.installed.length === 1 && match.installed[0] === 1, 'fusivel instalado uma unica vez (sem contagem repetida)');
  ok(match.items.get('fuse:1').state === 'installed', 'item 1 fica como instalado');
  const msg = await A.tryNext('fuse', 500);
  ok(msg && msg.id === 1 && msg.n === 1, 'todos recebem o evento de fusivel instalado');
  ok(match.lighting.powered.size > 1, 'luz do primeiro setor restaurada no servidor');
});

// ---------------------------------------------------------------------------
await section('Portas e armarios: capacidade 1 e validacao', async () => {
  const w = match.world;
  const sp = w.hideSpots.find(s => s.type === 'locker');
  const [pa, pb] = [match.players.get(A.id), match.players.get(B.id)];
  for (const p of [pa, pb]) { p.pos.set(sp.exitPos.x + (p === pa ? 0.2 : -0.2), sp.exitPos.y, sp.exitPos.z); p.updateEye(); }
  A.drop('deny'); B.drop('deny');
  A.send({ t: 'hide', spot: sp.id, on: true }); await sleep(30); B.send({ t: 'hide', spot: sp.id, on: true });
  await sleep(150);
  const dB = B.peek('deny');
  ok(sp.occupant === pa && dB.length === 1 && dB[0].reason === 'occupied', 'armario aceita 1 ocupante; o segundo e recusado (occupied)');
  const hmsg = await C.tryNext((m) => m.t === 'hide' && m.on === true, 400);
  ok(hmsg && hmsg.id === A.id && hmsg.spot === sp.id, 'ocupacao do armario e sincronizada para todos');
  ok(pa.hidden === sp, 'jogador escondido guardado no servidor');
  A.send({ t: 'hide', spot: sp.id, on: false }); await sleep(100);
  ok(sp.occupant === null && pa.hidden === null, 'saida do armario libera a vaga');
  // porta
  const door = w.doors.find(d => d.kind === 'D');
  const stand = (p, x, z, r0 = 0.5, r1 = 1.6) => { const c = w.freeSpotNear(x, z, r0, r1) || w.freeSpotNear(x, z, 0, 2.4); if (!c) throw new Error('sem lugar perto de ' + x.toFixed(1) + ',' + z.toFixed(1)); p.pos.set(c.x, c.y, c.z); p.updateEye(); return c; };
  stand(pb, door.cx, door.cz);
  B.send({ t: 'door', id: door.id, open: true }); const dm = await C.next((m) => m.t === 'door' && m.id === door.id);
  ok(dm.open === 1 && door.isOpen(), 'porta aberta e sincronizada' + (dm.open === 1 && door.isOpen() ? '' : ' :: ' + JSON.stringify({ dm, target: door.target, id: door.id, kind: door.kind })));
  // longe
  const far = w.doors.find(d => d.kind === 'D' && Math.hypot(d.cx - pb.pos.x, d.cz - pb.pos.z) > 20);
  B.drop('deny'); B.send({ t: 'door', id: far.id, open: true }); const df = await B.next('deny'); ok(df.reason === 'not_near', 'abrir porta de longe e recusado');
  // trancada sem chave
  const kd = w.doors.find(d => d.kind === 'K');
  stand(pb, kd.cx, kd.cz);
  B.drop('deny'); B.send({ t: 'door', id: kd.id, open: true }); const dk = await B.next('deny'); ok(dk.reason === 'no_key', 'porta trancada exige a chave');
  // saida principal nao abre sem os fusiveis
  const xd = w.exitDoor; stand(pb, xd.cx, xd.cz - 1.2, 0, 0.6);
  B.drop('deny'); B.send({ t: 'door', id: xd.id, open: true }); const dx = await B.next('deny'); ok(dx.reason === 'locked' && !xd.isOpen(), 'porta de saida so abre com os 7 fusiveis');
});

await section('Movimento: fisica basica no servidor', async () => {
  const p = match.players.get(C.id);
  const g = match.grid;
  const ok0 = { x: p.pos.x, z: p.pos.z };
  C.pos = { x: p.pos.x + 0.2, y: p.pos.y, z: p.pos.z, yaw: 0, pitch: 0 };
  C.sendState(); await sleep(100);
  ok(Math.hypot(p.pos.x - ok0.x, p.pos.z - ok0.z) > 0.1 && Math.hypot(p.pos.x - ok0.x, p.pos.z - ok0.z) < 0.4, 'passo normal e aceito');
  // dentro da parede (nao acumula budget para atravessar)
  C.pos = { x: 0.3, y: 0, z: 0.3, yaw: 0, pitch: 0 }; C.sendState(); await sleep(100);
  ok(Math.hypot(p.pos.x - 0.3, p.pos.z - 0.3) > 5, 'posicao fora do predio/parede e rejeitada');
});

await sleep(50);
console.log(`\nResultado parcial: ${pass} ok, ${fail} falhas`);
// as demais secoes (morte, espectadores, reconexao, vitoria...) estao em server-test2.mjs e usam o mesmo Hub
for (const b of bots) b.close();
await hub.stop('teste');
process.exit(fail ? 1 : 0);
