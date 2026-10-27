// Ajudantes dos testes do servidor: sobe um Hub em memoria e monta salas/partidas com robos.
import { Hub } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { Bot, sleep } from './bot.mjs';

export const ORIGIN = 'https://jogador.github.io';
export const T = { pass: 0, fail: 0, lines: [] };
export function ok(cond, msg) { if (cond) { T.pass++; T.lines.push('  ok   ' + msg); } else { T.fail++; T.lines.push('  FALHA ' + msg); console.log('  FALHA ' + msg); } }
export async function section(name, fn) {
  console.log('\n# ' + name);
  const before = T.lines.length;
  try { await fn(); } catch (e) { T.fail++; console.log('  EXCECAO em "' + name + '": ' + (e.stack || e)); }
  for (const r of T.lines.slice(before)) console.log(r);
}

export async function startHub(env = {}) {
  const cfg = loadConfig({ NODE_ENV: 'production', PORT: '0', ALLOWED_ORIGINS: ORIGIN, MAX_ROOMS: '60', ...env });
  const hub = new Hub(cfg);
  const log = console.log; console.log = (...a) => { if (!/^\[(sala|apagao|ws)/.test(String(a[0]))) log(...a); };
  await hub.start();
  console.log = log;
  const port = hub.server.address().port;
  const ctx = { hub, port, WS: `ws://127.0.0.1:${port}/ws`, HTTP: `http://127.0.0.1:${port}`, bots: [] };
  ctx.bot = async (name, o = {}) => { const b = new Bot(ctx.WS, name, { origin: ORIGIN, ...o }); await b.connect(); ctx.bots.push(b); return b; };
  ctx.stop = async () => { for (const b of ctx.bots) b.close(); await hub.stop('teste'); };
  return ctx;
}

// cria sala com n jogadores, todos prontos, e inicia a partida
// matchOpts: por padrao os testes usam os fusiveis nos lugares fixos (deterministico); passe {} para o sorteio de verdade
export async function makeMatch(ctx, n = 3, names = ['Ana', 'Beto', 'Cida', 'Davi'], matchOpts = { fixedFuses: true }) {
  const bots = [];
  for (let i = 0; i < n; i++) bots.push(await ctx.bot(names[i]));
  bots[0].send({ t: 'create' });
  const rs = await bots[0].next('room'); const code = rs.code;
  ctx.hub.rooms.get(code).matchOpts = matchOpts;
  for (let i = 1; i < n; i++) { bots[i].send({ t: 'join', code }); await bots[i].next('room'); bots[i].send({ t: 'ready', on: true }); }
  await sleep(80);
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.next('sync', 4000)));
  const room = ctx.hub.rooms.get(code), match = room.match;
  for (const b of bots) b.drop((m) => ['room', 'start', 'sync'].includes(m.t));
  return { bots, code, room, match, p: (b) => match.players.get(b.id) };
}

// coloca um jogador (estado do servidor) perto de um ponto livre e devolve a posicao
export function standNear(match, sp, x, z, r0 = 0, r1 = 1.6) {
  const c = match.world.freeSpotNear(x, z, r0, r1, 0.32, true) || match.world.freeSpotNear(x, z, 0, 2.6, 0.32, true);
  if (!c) throw new Error('sem lugar perto de ' + x.toFixed(1) + ',' + z.toFixed(1));
  sp.pos.set(c.x, c.y, c.z); sp.updateEye(); return c;
}
export const item = (match, key) => match.itemDefs.find(i => i.key === key);      // posicoes SORTEADAS desta partida (os fusiveis mudam a cada partida)
export { sleep };
