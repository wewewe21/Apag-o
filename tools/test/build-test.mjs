// Testa o build do cliente para GitHub Pages: caminhos relativos (funciona em subpasta), nada privado, servidor configuravel.
// Uso: node tools/test/build-test.mjs
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ok, section, T } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'apagao-dist-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const build = (args = []) => spawnSync(process.execPath, ['scripts/build-client.mjs', `--out=${OUT}`, ...args], { cwd: ROOT, encoding: 'utf8' });
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : o.push(p); } return o; };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

await section('Build: estrutura, three/ONNX locais, configuracao do servidor', async () => {
  const r = build(['--server-url=https://apagao-servidor.onrender.com']);
  ok(r.status === 0, 'npm run build:client termina sem erro', (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | '));
  const files = walk(OUT).map(f => path.relative(OUT, f).replace(/\\/g, '/'));
  for (const f of ['index.html', 'runtime-config.js', 'src/main.js', 'vendor/three/three.module.js', 'vendor/ort/ort.min.js', 'vendor/ort/ort-wasm-simd.wasm', 'vendor/sentencepiece.js', 'vendor/NOTICE.md', 'assets/anim/creature.json', 'assets/audio/manifest.json', '.nojekyll']) ok(files.includes(f), 'contem ' + f);
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok(/"three": "\.\/vendor\/three\/three\.module\.js"/.test(html) && !/cdn\.jsdelivr\.net\/npm\/three/.test(html), 'three.js vem do proprio site (caminho relativo), sem CDN');
  ok(!/(?:src|href)=["']\/(?!\/)/.test(html), 'index.html sem caminhos absolutos (/...)');
  const cfg = fs.readFileSync(path.join(OUT, 'runtime-config.js'), 'utf8');
  ok(/serverUrl:\s*"https:\/\/apagao-servidor\.onrender\.com"/.test(cfg), 'serverUrl gravado no runtime-config.js do build');
  ok(files.every(f => !/(^|\/)\./.test(f) || f === '.nojekyll'), 'nenhum arquivo oculto (.env etc.) na saida');
  ok(!files.some(f => f.startsWith('assets/audio/source/')), 'masters de audio (assets/audio/source) ficam de fora');
  ok(!files.some(f => /^(server|tools|docs|node_modules|scripts)\//.test(f)), 'servidor, ferramentas e docs nao vao para o site');
  ok(files.every(f => fs.statSync(path.join(OUT, f)).size < 95e6), 'nenhum arquivo passa do limite de 100 MB do GitHub');
  const badBuild = build(['--server-url=http://exemplo.com']);
  ok(badBuild.status !== 0 && /https/.test(badBuild.stderr), 'recusa serverUrl inseguro (http:// fora de localhost)');
  build(['--server-url=https://apagao-servidor.onrender.com']);
});

await section('Build: bloqueia segredos por engano', async () => {
  const probe = path.join(ROOT, 'src', 'zz_secret_probe.js');
  fs.writeFileSync(probe, "const x = 'ELEVENLABS_API_KEY=abcdef123456';\n");
  try {
    const r = build([]);
    ok(r.status !== 0 && /segredo/i.test(r.stderr), 'o build falha se um texto parecido com chave de API entrar no site', r.stderr.trim().split('\n').slice(-1)[0]);
  } finally { fs.rmSync(probe, { force: true }); }
  const r2 = build([]);
  ok(r2.status === 0, 'sem o texto suspeito o build volta a passar');
});

await section('Site em SUBPASTA (como https://usuario.github.io/apagao/)', async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, ['tools/serve-dist.mjs', `--dir=${OUT}`, '--base=/apagao/', `--port=${port}`], { cwd: ROOT, stdio: 'ignore' });
  try {
    await sleep(700);
    const base = `http://127.0.0.1:${port}/apagao/`;
    const get = async (u) => { const r = await fetch(u); return { status: r.status, text: r.status === 200 ? await r.text() : '' }; };
    const idx = await get(base);
    ok(idx.status === 200 && /<title>/.test(idx.text), 'index.html abre em /apagao/');
    // toda referencia relativa do HTML e do runtime-config resolve dentro da subpasta
    const refs = [...idx.text.matchAll(/(?:src|href)="(?!https?:|#|data:|\/\/)([^"]+)"/g)].map(m => m[1]);
    const results = await Promise.all(refs.map(async (r) => [r, (await fetch(new URL(r, base))).status]));
    ok(results.length > 0 && results.every(([, s]) => s === 200), `${results.length} referencias do HTML resolvem dentro da subpasta`, results.filter(([, s]) => s !== 200).join(';'));
    // modulos ES do jogo: segue os imports estaticos a partir de main.js e confere que todos existem
    const seen = new Set(), queue = ['src/main.js']; let missing = [];
    while (queue.length) {
      const rel = queue.pop(); if (seen.has(rel)) continue; seen.add(rel);
      const r = await fetch(new URL(rel, base)); if (r.status !== 200) { missing.push(rel); continue; }
      const t = await r.text();
      for (const m of t.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"](\.[^'"]+)['"]/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
    ok(missing.length === 0 && seen.size > 30, `${seen.size} modulos ES carregam a partir de main.js`, missing.join(','));
    // dados e binarios pedidos em tempo de execucao
    for (const f of ['assets/anim/creature.json', 'assets/audio/manifest.json', 'vendor/ort/ort-wasm-simd.wasm', 'vendor/three/three.module.js']) ok((await fetch(new URL(f, base))).status === 200, 'acessivel: ' + f);
    const man = JSON.parse((await get(new URL('assets/audio/manifest.json', base))).text);
    const entries = Object.values(man.assets).flat();
    const files = entries.map(e => e.file).filter(Boolean);
    const miss = []; for (const f of files.slice(0, 200)) if ((await fetch(new URL('assets/audio/' + f, base))).status !== 200) miss.push(f);
    ok(files.length > 20 && miss.length === 0, `${files.length} arquivos de audio do manifesto existem no site`, miss.slice(0, 3).join(','));
    ok((await fetch(`http://127.0.0.1:${port}/`)).status === 404 && (await fetch(new URL('.env', base))).status === 404, 'raiz fora da subpasta e .env nao sao servidos');
  } finally { srv.kill(); }
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
process.exit(T.fail ? 1 : 0);
