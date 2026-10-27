// Salas com espectadores: 4 jogam, ate 10 na sala; entrada tardia como espirito; fila (sem sorteio) para as vagas.
import { startHub, section, ok, T } from './harness.mjs';
import { sleep } from './bot.mjs';
import { COOP } from '../../src/shared/coop.js';

const ctx = await startHub();
const names = ['P1', 'P2', 'P3', 'P4', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const roleOf = (room, name) => [...room.members.values()].find(m => m.name === name)?.role;

await section('Limites: 4 jogam, ate 10 na sala, o 11o e recusado', async () => {
  ok(COOP.maxPlayers === 4 && COOP.maxMembers === 10, 'constantes: 4 jogadores, 10 na sala');
  const bots = []; for (const n of names) bots.push(await ctx.bot(n));
  bots[0].send({ t: 'create' }); const rs = await bots[0].next('room'); const code = rs.code;
  for (let i = 1; i < 10; i++) { bots[i].send({ t: 'join', code }); await bots[i].next('room'); }
  const room = ctx.hub.rooms.get(code);
  ok(room.count === 10, '10 pessoas na sala');
  ok(names.slice(0, 4).every(n => roleOf(room, n) === 'player') && names.slice(4).every(n => roleOf(room, n) === 'spectator'), 'os 4 primeiros jogam; os 6 seguintes entram como espectadores');
  const st = room.roomState(bots[9].id);
  ok(st.members.filter(m => m.role === 'spectator').map(m => m.q).join() === '1,2,3,4,5,6', 'fila numerada na ordem de chegada (1..6)');
  const lst = ctx.hub.listRooms().find(r => r.code === code);
  ok(lst.count === 10 && lst.max === 10 && lst.players === 4 && lst.maxPlayers === 4 && lst.spectators === 6, 'lista de salas mostra 4 jogadores e 6 espectadores');
  const X = await ctx.bot('X'); X.send({ t: 'join', code }); const e = await X.next('err');
  ok(e.code === 'room_full', 'o 11o e recusado (sala cheia)');
  X.close();

  // espectadores nao seguram a partida: so os jogadores precisam estar prontos
  bots[0].send({ t: 'start' }); const e2 = await bots[0].next('err');
  ok(e2.code === 'not_ready' && /P2/.test(e2.msg) && !/S1/.test(e2.msg), 'iniciar espera so os JOGADORES, nao os espectadores');
  for (const b of bots.slice(1, 4)) b.send({ t: 'ready', on: true });
  await sleep(100);
  bots[0].send({ t: 'start' });
  const syncs = await Promise.all(bots.map(b => b.next('sync', 5000)));
  const match = room.match;
  ok(match && match.aliveList().length === 4, 'a partida comeca com 4 vivos');
  ok(syncs.slice(0, 4).every(s => s.status === 'alive') && syncs.slice(4).every(s => s.status === 'dead'), 'espectadores nascem como espirito; jogadores como vivos');
  ok([...match.players.values()].filter(p => p.watcher).length === 6, 'servidor marca 6 espectadores');
  const spec = match.players.get(bots[4].id);
  const fuse = [...match.items.values()].find(i => i.type === 'fuse');
  bots[4].send({ t: 'take', key: fuse.key }); const d = await bots[4].next('deny');
  ok(d.reason === 'dead' && fuse.state === 'world', 'espectador nao interage com o mundo');
  ok(match.stats.deaths === 0 && spec.ghostT === Infinity, 'espectador nao conta como morte e nao assombra os vivos');
  // espectador ve os jogadores (snapshot) e os vivos nao veem espectadores
  match._broadcastSnapshots();
  const snapS = await bots[4].next('snap'), snapP = await bots[0].next('snap');
  ok(snapS.p.length === 9 && snapP.p.length === 3, `espectador recebe os 9 outros; vivo recebe so os 3 vivos (${snapS.p.length}/${snapP.p.length})`);
  // voz: espectador so fala com espirito
  ok(room.canVoice(spec, match.players.get(bots[5].id)) && !room.canVoice(spec, match.players.get(bots[0].id)), 'espectador fala com espectadores, nao com os vivos');

  // ---- fim da rodada: P2 sai durante a partida; ao terminar, a FILA (S1) ocupa a vaga; P1, P3, P4 continuam jogando ----
  bots[1].send({ t: 'leave' }); await bots[1].next('left_room');
  for (const p of [...match.players.values()]) if (p.status === 'alive') match._kill(p);
  await bots[0].next('end', 5000); await sleep(150);
  ok(room.phase === 'lobby' && !room.match, 'rodada terminou: sala volta ao lobby');
  ok(['P1', 'P3', 'P4'].every(n => roleOf(room, n) === 'player'), 'quem ja jogava continua jogando');
  ok(roleOf(room, 'S1') === 'player' && ['S2', 'S3', 'S4', 'S5', 'S6'].every(n => roleOf(room, n) === 'spectator'), 'a vaga de P2 foi para o PRIMEIRO da fila (S1); os demais seguem como espectadores');
  const st2 = room.roomState(bots[0].id);
  ok(st2.members.filter(m => m.role === 'spectator').map(m => m.q).join() === '1,2,3,4,5', 'fila renumerada (1..5)');
  const rolMsg = bots[4].peek('role');
  ok(rolMsg.length === 1 && rolMsg[0].role === 'player', 'S1 recebeu o aviso de que virou jogador');

  // ---- lobby: um jogador sai e o proximo da fila entra na hora ----
  bots[2].send({ t: 'leave' }); await bots[2].next('left_room');
  ok(roleOf(room, 'S2') === 'player' && roleOf(room, 'S3') === 'spectator', 'no lobby, quem sai cede a vaga ao proximo da fila (S2), sem sorteio');
  ok(room.hostId === bots[0].id, 'o criador (jogador) continua anfitriao');
});

await section('Entrada com a partida em andamento: so como espectador, a vaga so abre na proxima rodada', async () => {
  const bots = []; for (const n of ['A', 'B']) bots.push(await ctx.bot(n));
  bots[0].send({ t: 'create' }); const code = (await bots[0].next('room')).code;
  bots[1].send({ t: 'join', code }); await bots[1].next('room'); bots[1].send({ t: 'ready', on: true }); await sleep(100);
  bots[0].send({ t: 'start' }); await Promise.all(bots.map(b => b.next('sync', 5000)));
  const room = ctx.hub.rooms.get(code), match = room.match;
  ok(room.playersList().length === 2 && COOP.maxPlayers - room.playersList().length === 2, 'ha 2 vagas de jogador livres durante a partida');
  const late = await ctx.bot('Tarde'); late.send({ t: 'join', code });
  const st = await late.next('start'), sy = await late.next('sync');
  const me = room.members.get(late.id);
  ok(me.role === 'spectator' && sy.status === 'dead' && match.players.get(late.id).watcher && st.players.length === 3, 'mesmo com vaga livre, quem chega na partida entra como espectador (espirito)');
  ok(match.aliveList().length === 2, 'nao ganhou vida nova');
  for (const p of [...match.players.values()]) if (p.status === 'alive') match._kill(p);
  await bots[0].next('end', 5000); await sleep(150);
  ok(roleOf(room, 'Tarde') === 'player', 'na rodada seguinte a vaga livre e ocupada pela fila');
  await sleep(50);
});

await ctx.stop();
console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
process.exit(T.fail ? 1 : 0);
