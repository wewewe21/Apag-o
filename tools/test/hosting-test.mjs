// Teste de hospedagem do SERVIDOR: sobe `node server/index.js` de verdade (como o Render faria) com variaveis de ambiente
// e confere PORT, 0.0.0.0, /health, CORS, validacao de origem no WebSocket, /ice e ausencia de segredos.
// Uso: node tools/test/hosting-test.mjs      (nao usa a rede externa; usa 127.0.0.1)
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ok, section, T } from './harness.mjs';
import { PROTOCOL_VERSION } from '../../src/net/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function launch(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  for (let i = 0; i < 60 && !/http\/ws em/.test(out); i++) { if (child.exitCode != null) break; await sleep(100); }
  return { child, port, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws`, get out() { return out; }, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); setTimeout(r, 1500); }) };
}
const getJson = async (url, headers = {}) => { const r = await fetch(url, { headers }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) }; };
const tryWs = (url, origin) => new Promise((resolve) => {
  const ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
  const done = (v) => { try { ws.terminate(); } catch { /* ok */ } resolve(v); };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Teste' })));
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'welcome') done({ ok: true, welcome: m }); });
  ws.on('unexpected-response', (req, res) => done({ ok: false, status: res.statusCode }));
  ws.on('error', () => setTimeout(() => done({ ok: false, status: 'erro' }), 20));
  setTimeout(() => done({ ok: false, status: 'timeout' }), 3000);
});

const PAGES = 'https://jogador.github.io';

await section('Producao: PORT, 0.0.0.0, /health, CORS e origem', async () => {
  const s = await launch({ NODE_ENV: 'production', ALLOWED_ORIGINS: `${PAGES}/, https://outro.exemplo.com`, MAX_ROOMS: '3', TURN_URLS: 'turn:turn.exemplo.com:3478?transport=udp', TURN_SECRET: 'segredo-so-no-servidor' });
  try {
    ok(new RegExp(`0\\.0\\.0\\.0:${s.port}`).test(s.out) && /producao/.test(s.out), 'escuta em 0.0.0.0 na porta do ambiente (PORT)', s.out.split('\n')[0]);
    const h = await getJson(s.base + '/health');
    ok(h.status === 200 && h.json.ok === true && h.json.protocol === PROTOCOL_VERSION && h.json.maxRooms === 3, '/health responde 200 sem Origin (health check do provedor)', JSON.stringify(h.json));
    ok(!h.headers.get('access-control-allow-origin'), '/health sem Origin nao emite cabecalho CORS');
    const okOrigin = await getJson(s.base + '/rooms', { Origin: PAGES });
    ok(okOrigin.status === 200 && okOrigin.headers.get('access-control-allow-origin') === PAGES, 'origem permitida (GitHub Pages) recebe CORS exato');
    const outra = await getJson(s.base + '/rooms', { Origin: 'https://outro.exemplo.com' });
    ok(outra.status === 200, 'segunda origem listada tambem e aceita');
    const bad = await getJson(s.base + '/rooms', { Origin: 'https://malvado.example' });
    ok(bad.status === 403 && !bad.headers.get('access-control-allow-origin'), 'origem nao listada: 403 e sem CORS');
    const sub = await getJson(s.base + '/rooms', { Origin: PAGES + '.malvado.example' });
    ok(sub.status === 403, 'origem parecida (sufixo) nao passa');
    const local = await getJson(s.base + '/rooms', { Origin: 'http://localhost:8765' });
    ok(local.status === 403, 'em producao nem localhost passa sem estar na lista');
    const pre = await fetch(s.base + '/rooms', { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'GET' } });
    ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === PAGES, 'preflight OPTIONS ok para a origem permitida');
    const post = await fetch(s.base + '/health', { method: 'POST' });
    ok(post.status === 405, 'metodos que nao sao GET/OPTIONS sao recusados');
    const w1 = await tryWs(s.ws, PAGES);
    ok(w1.ok && w1.welcome.id != null && !!w1.welcome.token,'WebSocket com origem permitida conecta e recebe welcome');
    const w2 = await tryWs(s.ws, 'https://malvado.example');
    ok(!w2.ok && w2.status === 403, 'WebSocket de origem nao permitida e recusado (403)');
    const w3 = await tryWs(s.ws, null);
    ok(!w3.ok && w3.status === 403, 'WebSocket sem Origin e recusado em producao');
    const ice = await getJson(s.base + '/ice', { Origin: PAGES });
    const turn = ice.json.iceServers.find(x => x.username);
    ok(!!turn && /^\d+:p/.test(turn.username) && turn.credential && !JSON.stringify(ice.json).includes('segredo-so-no-servidor'), '/ice entrega TURN com credencial temporaria (HMAC) e nunca o segredo');
    ok(ice.json.iceServers.some(x => String(x.urls).includes('stun:')), '/ice inclui STUN publico por padrao');
    ok(!(await getJson(s.base + '/ice', { Origin: 'https://malvado.example' })).json.iceServers, '/ice nao responde a origens nao permitidas');
    const nf = await getJson(s.base + '/qualquer-coisa');
    ok(nf.status === 404, 'rota desconhecida: 404');
    ok(!/segredo-so-no-servidor/.test(s.out), 'segredo nao aparece nos logs');
  } finally { await s.stop(); }
});

await section('Producao sem ALLOWED_ORIGINS: avisa e recusa navegadores', async () => {
  const s = await launch({ NODE_ENV: 'production' });
  try {
    ok(/ALLOWED_ORIGINS esta vazio/.test(s.out), 'aviso claro no log de inicializacao');
    const w = await tryWs(s.ws, PAGES);
    ok(!w.ok && w.status === 403, 'sem origens configuradas nenhum site conecta (padrao seguro)');
    ok((await getJson(s.base + '/health')).status === 200, '/health continua respondendo (o Render precisa dele)');
  } finally { await s.stop(); }
});

await section('Desenvolvimento: localhost liberado, ganchos de teste desligados', async () => {
  const { loadConfig } = await import('../../server/config.js');
  ok(loadConfig({ NODE_ENV: 'production', APAGAO_TEST: '1' }).testHooks === false, 'ganchos de teste (teleporte etc.) ficam desligados em producao mesmo com APAGAO_TEST=1');
  ok(loadConfig({ APAGAO_TEST: '1' }).testHooks === true && loadConfig({}).testHooks === false, 'so ligam em desenvolvimento e com APAGAO_TEST=1');
  const d = await launch({});
  try {
    const l = await getJson(d.base + '/rooms', { Origin: 'http://localhost:8765' });
    ok(l.status === 200, 'em desenvolvimento http://localhost:* e aceito');
    const w = await tryWs(d.ws, 'http://localhost:8765');
    ok(w.ok, 'WebSocket de localhost conecta em desenvolvimento');
  } finally { await d.stop(); }
});

await section('Sem disco e sem segredos no codigo', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const files = []; (function walk(d) { for (const e of readdirSync(d)) { const p = path.join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e)) files.push(p); } })(path.join(ROOT, 'server'));
  const writes = files.filter(f => /writeFile|appendFile|createWriteStream|mkdirSync|sqlite|better-sqlite|mongodb/.test(readFileSync(f, 'utf8')));
  ok(writes.length === 0, 'o servidor nao escreve em disco nem usa banco (salas so em memoria)', writes.join(','));
  const sec = files.filter(f => /(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(readFileSync(f, 'utf8')));
  ok(sec.length === 0, 'nenhum segredo literal no codigo do servidor', sec.join(','));
});

console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
process.exit(T.fail ? 1 : 0);
