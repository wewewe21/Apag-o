// Robo jogador para testar o cliente no navegador: entra na primeira sala aberta, fica pronto e anda em circulos perto do spawn.
// Uso: node tools/test/playbot.mjs [nome] [ws://localhost:8080/ws] [comportamento: circle|idle] [--meet=SEGUNDOS] [--exit=SEGUNDOS]
//   --meet: depois de N s vai (teleporte de teste) ao ponto de reuniao do quadro;  --exit: depois de N s vai a saida.
// Precisa do servidor com APAGAO_TEST=1 para os teleportes.
import { readFileSync } from 'node:fs';
import { Bot, sleep } from './bot.mjs';
import { Grid } from '../../src/world/grid.js';
import { buildLayout } from '../../src/world/layout.js';
import { COOP } from '../../src/shared/coop.js';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const pos = args.filter(a => !a.startsWith('--'));
const name = pos[0] || 'Robo', url = pos[1] || 'ws://localhost:8080/ws', mode = pos[2] || 'circle';
const spec = JSON.parse(readFileSync(new URL('../../server/worldspec.json', import.meta.url), 'utf8'));
const bot = new Bot(url, name, { origin: 'http://localhost:8765' });
await bot.connect();
console.log(`[${name}] conectado id=${bot.id}`);

let code = null;
while (!code) {
  bot.send({ t: 'rooms' });
  const r = await bot.next('rooms', 3000);
  const room = r.rooms.find(x => x.phase === 'lobby' && x.count < x.max);
  if (room) code = room.code; else await sleep(1000);
}
bot.send({ t: 'join', code }); await bot.next('room');
console.log(`[${name}] entrou na sala ${code}`);
bot.send({ t: 'ready', on: true });
const sync = await bot.next('sync', 600000);
console.log(`[${name}] partida iniciada; pose`, sync.pose);
const g = new Grid(buildLayout());
bot.pos = { ...bot.pos, x: sync.pose.x, y: 0, z: sync.pose.z, yaw: sync.pose.yaw, pitch: -0.05 };
const cx = sync.pose.x, cz = sync.pose.z;
const t0 = Date.now(); let t = 0, frozen = false;
const tp = (x, z) => { bot.send({ t: 'dbg', cmd: 'tp', x, z }); frozen = true; setTimeout(() => { frozen = false; }, 600); };
let didMeet = false, didExit = false;
setInterval(() => {
  t += 1 / 15;
  const el = (Date.now() - t0) / 1000;
  if (flags.meet && !didMeet && el > +flags.meet) { didMeet = true; tp(spec.panel.x + 0.5, spec.panel.z - COOP.meeting.forward); console.log(`[${name}] indo ao ponto de reuniao`); }
  if (flags.exit && !didExit && el > +flags.exit) { didExit = true; tp(spec.exitTrigger.x, spec.exitTrigger.z + 0.6); console.log(`[${name}] indo a saida`); }
  if (!frozen && mode === 'circle' && !didMeet) {
    const nx = cx + Math.cos(t * 0.5) * 2.2, nz = cz + Math.sin(t * 0.5) * 2.2;
    const [qx, qz] = g.collideCircle(nx, nz, 0.32);
    bot.pos.yaw = Math.atan2(-(nx - bot.pos.x), -(nz - bot.pos.z)) || bot.pos.yaw;
    bot.pos.x = qx; bot.pos.z = qz;
  }
  bot.send({ t: 's', x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yw: bot.pos.yaw, pt: bot.pos.pitch, cr: 0, mv: mode === 'circle' && !didMeet ? 1 : 0, fl: [1, 0], hb: 0 });
}, 1000 / 15);
bot.ws.on('close', () => { console.log('fechado'); process.exit(0); });
bot.ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'end') console.log(`[${name}] fim: ${m.result}`); if (m.t === 'dead' && m.id === bot.id) console.log(`[${name}] morri`); });
