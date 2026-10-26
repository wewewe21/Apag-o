import { readFileSync } from 'node:fs';
import { Match, ServerPlayer } from '../../server/match.js';
import { AnimData } from '../../src/shared/animdata.js';
const anim = new AnimData(JSON.parse(readFileSync(new URL('../../assets/anim/creature.json', import.meta.url), 'utf8')));
const sent = [];
const room = { broadcast: (m) => sent.push(['all', m]), send: (p, m) => sent.push([p.id, m]), onEnd: (r, s) => sent.push(['end', r, s]) };
const mk = (id) => { const p = new ServerPlayer(id, 'P' + id, 'tok' + id); p.conn = { send: (m) => {} }; return p; };
const ps = [1, 2, 3, 4].map(mk);
const t0 = performance.now();
const m = new Match(room, ps, anim);
console.log('match criado em', (performance.now() - t0).toFixed(0), 'ms');
console.log('spawns:', ps.map(p => [p.pos.x.toFixed(2), p.pos.z.toFixed(2)].join(',')).join(' | '));
let minSep = 9; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) minSep = Math.min(minSep, Math.hypot(ps[i].pos.x - ps[j].pos.x, ps[i].pos.z - ps[j].pos.z));
console.log('menor distancia entre jogadores:', minSep.toFixed(2));
const t1 = performance.now();
for (let i = 0; i < 20 * 60; i++) m.tick(1 / 20);      // 60 s
console.log('60 s de simulacao (criatura dormindo):', (performance.now() - t1).toFixed(0), 'ms');
m._wakeCreature();
const t2 = performance.now();
for (let i = 0; i < 20 * 120; i++) m.tick(1 / 20);      // 120 s com criatura ativa
const dt2 = performance.now() - t2;
console.log('120 s com criatura ativa:', dt2.toFixed(0), 'ms =>', (dt2 / 120 / 10).toFixed(2), '% de 1 CPU');
console.log('estado criatura:', m.ai.state, 'eventos:', sent.length, 'jogadores vivos:', m.aliveList().length);
