// Monta o cliente estatico em dist/ para hospedar em GitHub Pages (ou qualquer hospedagem de arquivos estaticos).
//   node scripts/build-client.mjs                       -> dist/
//   node scripts/build-client.mjs --server-url=https://apagao-server.onrender.com
//   node scripts/build-client.mjs --out=/caminho/saida
// Tambem le a variavel de ambiente APAGAO_SERVER_URL (usada pelo workflow do GitHub Actions).
//
// Todos os caminhos gerados sao RELATIVOS, entao o site funciona em subpasta (https://usuario.github.io/nome-do-repo/).
// O three.js e o ONNX Runtime vao junto (nada de CDN para o jogo rodar; so as fontes do Google sao opcionais).
// NUNCA copia: .env, arquivos que comecam com ponto, assets/audio/source (masters), node_modules, tools, server, docs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const OUT = path.resolve(arg('out') || path.join(ROOT, 'dist'));
const SERVER_URL = (arg('server-url') || process.env.APAGAO_SERVER_URL || '').trim().replace(/\/+$/, '');
const MODEL_BASE = (arg('mimic-model-base') || process.env.APAGAO_MIMIC_MODEL_BASE || '').trim().replace(/\/+$/, '');

const log = (...a) => console.log('[build]', ...a);
const die = (msg) => { console.error('[build] ERRO: ' + msg); process.exit(1); };

// ---------- seguranca: nada de segredo ou arquivo privado ----------
const SKIP_NAME = (n) => n.startsWith('.') || n === 'source' || n === '__pycache__' || n.endsWith('.partial') || n === 'node_modules' || n.endsWith('.map');
function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAME(e.name) || !filter(e.name, from)) continue;
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}
function copyFile(from, to) {
  if (!fs.existsSync(from)) die('arquivo necessario nao encontrado: ' + path.relative(ROOT, from) + ' (rode "npm ci" antes)');
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to);
}

if (OUT === ROOT || OUT === path.dirname(ROOT) || !OUT.startsWith(ROOT) && !arg('out')) die('pasta de saida invalida: ' + OUT);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- copia ----------
copyDir(path.join(ROOT, 'src'), path.join(OUT, 'src'));
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
copyFile(path.join(ROOT, 'vendor', 'sentencepiece.js'), path.join(OUT, 'vendor', 'sentencepiece.js'));
copyFile(path.join(ROOT, 'vendor', 'NOTICE.md'), path.join(OUT, 'vendor', 'NOTICE.md'));
copyDir(path.join(ROOT, 'vendor', 'fbx'), path.join(OUT, 'vendor', 'fbx'));
copyDir(path.join(ROOT, 'vendor', 'gltf'), path.join(OUT, 'vendor', 'gltf'));
copyFile(path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'), path.join(OUT, 'vendor', 'three', 'three.module.js'));
copyFile(path.join(ROOT, 'node_modules', 'three', 'LICENSE'), path.join(OUT, 'vendor', 'three', 'LICENSE'));
const ortDist = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
copyFile(path.join(ortDist, 'ort.min.js'), path.join(OUT, 'vendor', 'ort', 'ort.min.js'));
copyFile(path.join(ortDist, 'ort-wasm-simd.wasm'), path.join(OUT, 'vendor', 'ort', 'ort-wasm-simd.wasm'));
fs.writeFileSync(path.join(OUT, 'vendor', 'ort', 'LICENSE.txt'), ['ONNX Runtime Web (onnxruntime-web 1.18.0)', 'Copyright (c) Microsoft Corporation. MIT License.', 'https://github.com/microsoft/onnxruntime/blob/main/LICENSE', ''].join(String.fromCharCode(10)));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');                 // GitHub Pages: nao processar com Jekyll (pastas com _ etc.)

// ---------- index.html: three.js local (caminho relativo) ----------
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const map = /<script type="importmap">[\s\S]*?<\/script>/;
if (!map.test(html)) die('importmap nao encontrado no index.html');
html = html.replace(map, '<script type="importmap">{ "imports": { "three": "./vendor/three/three.module.js" } }</script>');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// ---------- runtime-config.js ----------
let cfg = fs.readFileSync(path.join(ROOT, 'runtime-config.js'), 'utf8');
const setKey = (src, key, value) => src.replace(new RegExp(`(\\n\\s*${key}:\\s*)'[^']*'`), (_, a) => `${a}${JSON.stringify(value)}`);
if (SERVER_URL) {
  if (!/^https:\/\/[^\s'"]+$/.test(SERVER_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SERVER_URL)) die('--server-url precisa comecar com https:// (recebido: ' + SERVER_URL + ')');
  cfg = setKey(cfg, 'serverUrl', SERVER_URL);
}
if (MODEL_BASE) cfg = setKey(cfg, 'mimicModelBase', MODEL_BASE);
fs.writeFileSync(path.join(OUT, 'runtime-config.js'), cfg);

// ---------- verificacoes ----------
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(OUT);
const rel = (p) => path.relative(OUT, p).replace(/\\/g, '/');

// 1) nada privado
const bad = files.filter(f => /(^|\/)\.env|(^|\/)source\/|\.partial$|\.pem$|\.key$/i.test(rel(f)));
if (bad.length) die('arquivo privado na saida: ' + bad.map(rel).join(', '));
// 2) nenhum texto com cara de segredo (chaves de API conhecidas) — le so arquivos de texto pequenos
const secretRx = /(xi-api-key|sk_[a-f0-9]{24,}|ELEVENLABS_API_KEY\s*=\s*\S+|TURN_SECRET\s*=\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
for (const f of files) {
  if (!/\.(js|mjs|json|html|md|txt|css)$/.test(f) || fs.statSync(f).size > 6e6) continue;
  const m = secretRx.exec(fs.readFileSync(f, 'utf8'));
  if (m && !/vendor\/(three|ort)|sentencepiece/.test(rel(f))) die(`possivel segredo em ${rel(f)}: "${m[0].slice(0, 30)}..."`);
}
// 3) caminhos absolutos de site quebrariam em subpasta (GitHub Pages de projeto)
const absRx = /(?:src|href)\s*=\s*["']\/(?!\/)/g;
if (absRx.test(html)) die('index.html usa caminho absoluto (/...): use caminhos relativos');
for (const f of files.filter(f => f.endsWith('.js') && rel(f).startsWith('src/'))) {
  const t = fs.readFileSync(f, 'utf8');
  const m = /(?:fetch|import)\(\s*['"`]\/(?!\/)/.exec(t) || /from\s+['"]\/(?!\/)/.exec(t);
  if (m) die(`${rel(f)} usa caminho absoluto: ${m[0]}`);
}
// 4) todo arquivo cabe nos limites do GitHub (100 MB por arquivo)
const big = files.filter(f => fs.statSync(f).size > 95e6);
if (big.length) die('arquivo grande demais para o GitHub: ' + big.map(rel).join(', '));
// 5) modulos referenciados existem (import estatico relativo)
const importRx = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g;
let missing = 0;
for (const f of files.filter(f => f.endsWith('.js') && rel(f).startsWith('src/'))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(importRx)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || /manifest\.json|\$\{/.test(spec) || spec.startsWith('../tools/')) continue;     // ferramentas de QA (so em desenvolvimento)
    const target = path.resolve(path.dirname(f), spec.split('?')[0]);
    if (!fs.existsSync(target)) { console.error(`  faltando: ${rel(f)} -> ${spec}`); missing++; }
  }
}
if (missing) die(missing + ' importacao(oes) quebrada(s)');

const total = files.reduce((a, f) => a + fs.statSync(f).size, 0);
log(`ok: ${files.length} arquivos, ${(total / 1e6).toFixed(1)} MB em ${path.relative(process.cwd(), OUT) || '.'}`);
log(SERVER_URL ? `servidor multiplayer: ${SERVER_URL}` : 'servidor multiplayer: (nao definido) edite dist/runtime-config.js ou rode com --server-url=https://...');
