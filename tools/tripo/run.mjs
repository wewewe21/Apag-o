// Gera os assets 3D do jogo com a API do Tripo (texto -> modelo), de forma ECONOMICA e repetivel.
//
//   $env:TRIPO_API_KEY = "tsk_..."          (PowerShell)   |   export TRIPO_API_KEY=tsk_...   (bash)
//   node tools/tripo/run.mjs plan                       saldo + tabela do que seria gerado (nao gasta nada)
//   node tools/tripo/run.mjs generate                   gera tudo que falta, em ordem de prioridade, ate acabar o credito
//   node tools/tripo/run.mjs generate --only hospital_bed,wheelchair
//   node tools/tripo/run.mjs generate --max-credits 200 --max-assets 4
//   node tools/tripo/run.mjs status                     o que ja foi baixado
//   node tools/tripo/run.mjs generate --force gurney    refaz UM asset (gasta credito de novo)
//
// Garantias de custo: antes de cada geracao confere o saldo; depois da primeira mede o custo real (saldo antes - depois) e so
// continua se o saldo cobrir a proxima; nunca regera um asset ja baixado sem --force; --max-credits e --max-assets limitam o gasto.
// A chave NUNCA e gravada em arquivo nem impressa. Os .glb baixados ficam em tools/tripo/raw/<id>/ (quarentena: dado nao confiavel);
// quem os valida, otimiza e publica em assets/models/ e o tools/tripo/process.py.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.TRIPO_API_BASE || 'https://api.tripo3d.ai/v2/openapi';
const KEY = process.env.TRIPO_API_KEY || '';
// TRIPO_WORK_DIR / TRIPO_MANIFEST / TRIPO_POLL_MS existem so para os testes (servidor falso local; nao tocam nos arquivos reais)
const WORK = process.env.TRIPO_WORK_DIR || HERE;
const STATE = path.join(WORK, 'state.json');
const RAW = path.join(WORK, 'raw');
const POLL_MS = Number(process.env.TRIPO_POLL_MS) || 0;
const MAX_GLB = 80 * 1024 * 1024;

const args = process.argv.slice(2);
const cmd = args[0] || 'plan';
const flag = (n, d = null) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));
const log = (...a) => console.log(...a.map(clean));

async function api(method, route, body, { retries = 3, timeout = 60000 } = {}) {
  if (!KEY) throw new Error('defina TRIPO_API_KEY no ambiente (a chave nunca vai para arquivo).');
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(API + route, { method, signal: ctl.signal, headers: { Authorization: 'Bearer ' + KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { code: -1, message: text.slice(0, 200) }; }
      if (res.status >= 500 && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      return json;
    } catch (e) {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      throw new Error('falha de rede em ' + route + ': ' + clean(e.message));
    } finally { clearTimeout(t); }
  }
}

const readJson = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const writeJson = async (p, v) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2) + '\n'); };
const balance = async () => { const r = await api('GET', '/user/balance'); if (r.code !== 0) throw new Error(`saldo: ${r.code} ${r.message}`); return r.data.balance; };

const manifest = await readJson(process.env.TRIPO_MANIFEST || path.join(HERE, 'assets.json'), null);
if (!manifest) throw new Error('tools/tripo/assets.json nao encontrado');
const state = await readJson(STATE, { assets: {} });
const defaults = manifest.defaults || {};
const all = [...manifest.assets].sort((a, b) => a.priority - b.priority);
const only = (flag('only') && flag('only') !== true) ? String(flag('only')).split(',') : null;
const force = (flag('force') && flag('force') !== true) ? String(flag('force')).split(',') : [];
const wanted = all.filter(a => (!only || only.includes(a.id)));
const done = (id) => state.assets[id]?.status === 'downloaded';

function body(a, minimal = false) {
  const prompt = `${a.prompt}. ${a.style_override || manifest.style}`.slice(0, 1000);
  const b = { type: 'text_to_model', prompt };
  if (minimal) return b;
  b.negative_prompt = (manifest.negative || '').slice(0, 250);
  b.face_limit = a.face_limit ?? defaults.face_limit;
  b.texture = a.texture ?? defaults.texture;
  b.pbr = a.pbr ?? defaults.pbr;
  if (a.texture_quality ?? defaults.texture_quality) b.texture_quality = a.texture_quality ?? defaults.texture_quality;
  if (a.model_version || process.env.TRIPO_MODEL_VERSION) b.model_version = a.model_version || process.env.TRIPO_MODEL_VERSION;   // sem isso a API usa o padrao atual
  return b;
}

async function generateOne(a) {
  const before = await balance();
  let r = await api('POST', '/task', body(a));
  if (r.code !== 0 && /param|invalid|unknown|field/i.test(String(r.message)) && r.code !== 2010) {
    log(`  (parametro recusado: "${r.message}") tentando so com o essencial`);
    r = await api('POST', '/task', body(a, true));
  }
  if (r.code !== 0) return { ok: false, why: `${r.code} ${r.message}`, stop: r.code === 2010 };
  const id = r.data.task_id; log(`  tarefa ${id} criada; aguardando...`);
  let last = -1, out = null;
  for (let i = 0; i < 240; i++) {                       // ate ~20 min
    await sleep(POLL_MS || (i < 6 ? 4000 : 5000));
    const t = await api('GET', '/task/' + id);
    if (t.code !== 0) { log('  consulta:', t.code, t.message); continue; }
    const s = t.data.status, p = t.data.progress ?? 0;
    if (p !== last) { process.stdout.write(`  ${s} ${p}%\r`); last = p; }
    if (s === 'success') { out = t.data.output || {}; break; }
    if (['failed', 'cancelled', 'banned', 'expired'].includes(s)) return { ok: false, why: `status ${s}`, taskId: id };
  }
  if (!out) return { ok: false, why: 'tempo esgotado esperando a tarefa', taskId: id };
  const url = out.pbr_model || out.model || out.base_model;
  if (!url) return { ok: false, why: 'tarefa concluida sem URL de modelo: ' + JSON.stringify(Object.keys(out)), taskId: id };
  const dir = path.join(RAW, a.id); await fs.mkdir(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) return { ok: false, why: 'download falhou: HTTP ' + res.status, taskId: id };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.length > MAX_GLB || buf.toString('latin1', 0, 4) !== 'glTF') return { ok: false, why: `arquivo baixado nao parece um GLB valido (${buf.length} bytes)`, taskId: id };
  const file = path.join(dir, 'model.glb'); await fs.writeFile(file, buf);
  const after = await balance();
  return { ok: true, taskId: id, file: path.relative(WORK, file).replace(/\\/g, '/'), bytes: buf.length, credits: Math.max(0, before - after), balanceAfter: after };
}

if (cmd === 'status') {
  for (const a of all) { const s = state.assets[a.id]; log(`${String(a.priority).padStart(2)} ${a.id.padEnd(16)} ${s ? `${s.status}  ${s.credits ?? '?'} cred  ${s.bytes ? (s.bytes / 1048576).toFixed(1) + ' MB' : ''}` : 'pendente'}`); }
  process.exit(0);
}

if (cmd === 'plan' || flag('dry-run')) {
  const bal = KEY ? await balance() : null;
  log(`saldo: ${bal ?? '(sem chave: defina TRIPO_API_KEY)'} creditos`);
  const known = Object.values(state.assets).filter(s => s.credits > 0).map(s => s.credits);
  const per = known.length ? Math.round(known.reduce((x, y) => x + y, 0) / known.length) : null;
  log(per ? `custo medio medido: ${per} creditos por asset` : 'custo por asset: ainda nao medido (a primeira geracao mede; texto->modelo com textura costuma ficar entre 20 e 40 creditos)');
  for (const a of wanted) log(`${String(a.priority).padStart(2)} ${a.id.padEnd(16)} ${done(a.id) ? 'ja baixado' : 'a gerar   '}  ${a.size.w}x${a.size.h}x${a.size.d} m  - ${a.why}`);
  const todo = wanted.filter(a => !done(a.id)).length;
  log(`\n${todo} asset(s) a gerar${per ? `, ~${todo * per} creditos` : ` (para tudo, recarregue ~${todo * 40} creditos por seguranca)`}`);
  process.exit(0);
}

if (cmd !== 'generate') { log('uso: node tools/tripo/run.mjs plan|generate|status [--only a,b] [--max-credits N] [--max-assets N] [--force id]'); process.exit(2); }

const maxCredits = Number(flag('max-credits', Infinity)), maxAssets = Number(flag('max-assets', Infinity));
let spent = 0, made = 0, perTask = Object.values(state.assets).filter(s => s.credits > 0).map(s => s.credits).sort((a, b) => a - b).pop() || 0;
let bal = await balance();
log(`saldo inicial: ${bal} creditos`);
if (bal <= 0) { log('\nSem credito: a API recusa qualquer geracao (codigo 2010). Recarregue em https://platform.tripo3d.ai e rode de novo: o que ja foi baixado nao e regerado.'); process.exit(3); }

for (const a of wanted) {
  if (done(a.id) && !force.includes(a.id)) { log(`= ${a.id}: ja baixado`); continue; }
  if (made >= maxAssets) { log('limite --max-assets atingido'); break; }
  if (spent + perTask > maxCredits) { log(`limite --max-credits ${maxCredits} atingido (gasto ${spent})`); break; }
  if (bal < Math.max(perTask, 1)) { log(`saldo (${bal}) nao cobre o proximo asset (~${perTask}); parando`); break; }
  log(`+ ${a.id} (prioridade ${a.priority})`);
  const r = await generateOne(a);
  if (!r.ok) {
    log(`  FALHOU: ${r.why}`);
    state.assets[a.id] = { status: 'failed', why: r.why, taskId: r.taskId, at: new Date().toISOString() }; await writeJson(STATE, state);
    if (r.stop) { log('sem credito suficiente: parando'); break; }
    continue;
  }
  state.assets[a.id] = { status: 'downloaded', taskId: r.taskId, file: r.file, bytes: r.bytes, credits: r.credits, at: new Date().toISOString() };
  await writeJson(STATE, state);
  spent += r.credits; made++; bal = r.balanceAfter; perTask = Math.max(perTask, r.credits);
  log(`  ok: ${(r.bytes / 1048576).toFixed(1)} MB, ${r.credits} creditos (saldo ${bal})`);
}
log(`\nresumo: ${made} asset(s) novos, ${spent} creditos gastos, saldo ${bal}.`);
if (made) log('proximo passo: python tools/tripo/process.py   (valida, reduz texturas e publica em assets/models/)');
