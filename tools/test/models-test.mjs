// Modelos 3D opcionais (assets/models): normalizacao, biblioteca, integracao no mundo (colisao identica!), pipeline de
// processamento (process.py) e executor da API do Tripo contra um servidor FALSO local (nada gasta credito nem usa rede real).
// Uso: node tools/test/models-test.mjs
import * as THREE from 'three';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FALHA ') + m); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROOT, 'tools/test/fixtures');
const tmps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apagao-models-')); tmps.push(d); return d; };
process.on('exit', () => { for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fica no temp do sistema */ } } });

// ---- canvas falso (como scripts/gen-worldspec.mjs): o mundo monta em Node ----
const noop = () => {};
const fakeCtx = (w, h) => new Proxy({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }), getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), measureText: () => ({ width: 10 }), canvas: { width: w, height: h } }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
globalThis.document = { createElement: () => { const c = { width: 1, height: 1 }; c.getContext = () => fakeCtx(c.width, c.height); return c; } };
const { prepareModel, ModelLibrary, loadModelLibrary } = await import('../../src/world/models.js');
const { World } = await import('../../src/world/world.js');
const { extractSpec } = await import('../../src/shared/worldspec.js');

const mesh = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 })); m.position.set(x, y, z); return m; };
const dimsOf = (o) => { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o, true); return { b, s: b.getSize(new THREE.Vector3()), c: b.getCenter(new THREE.Vector3()) }; };

console.log('\n# prepareModel: escala, origem, frente e material (modelo "gerado": escala/origem/frente arbitrarias)');
{
  const mk = () => { const g = new THREE.Group(); g.add(mesh(2, 1, 4, 5, 3, -2)); g.add(mesh(0.4, 0.4, 0.4, 5, 3, 0.4)); return g; };   // o "nariz" fica em +Z do modelo
  const a = prepareModel(mk(), { size: { w: 1, h: 1, d: 1 } });
  const A = dimsOf(a.pivot);
  ok(Math.abs(A.s.z - 1) < 1e-6 && A.s.x <= 1 + 1e-6 && A.s.y <= 1 + 1e-6, `'contain': cabe em 1x1x1 e o eixo limitante bate (${A.s.toArray().map(v => v.toFixed(2)).join(' x ')})`);
  ok(Math.abs(A.b.min.y) < 1e-6 && Math.abs(A.c.x) < 1e-6 && Math.abs(A.c.z) < 1e-6, 'origem no centro da base (y minimo 0, centro em x e z = 0)');
  ok(Math.abs(a.dims.d - A.s.z) < 1e-9, 'dims informa o tamanho final');
  const nose0 = (() => { const n = a.pivot.children[0].children[1]; const p = new THREE.Vector3(); n.getWorldPosition(p); return p.z; })();
  const b = prepareModel(mk(), { size: { w: 1, h: 1, d: 1 }, yaw: 180 });
  const nose180 = (() => { const n = b.pivot.children[0].children[1]; const p = new THREE.Vector3(); n.getWorldPosition(p); return p.z; })();
  ok(nose0 > 0 && nose180 < 0, `spec.yaw = 180 vira a frente (nariz de +Z para -Z: ${nose0.toFixed(2)} -> ${nose180.toFixed(2)})`);
  const c = dimsOf(prepareModel(mk(), { size: { w: 1, h: 2, d: 1 }, fit: 'height' }).pivot).s;
  ok(Math.abs(c.y - 2) < 1e-6, `fit 'height': so a altura manda (${c.y.toFixed(2)} m)`);
  const e = dimsOf(prepareModel(mk(), { size: { w: 1, h: 2, d: 3 }, fit: 'exact' }).pivot).s;
  ok(Math.abs(e.x - 1) < 1e-6 && Math.abs(e.y - 2) < 1e-6 && Math.abs(e.z - 3) < 1e-6, "fit 'exact': cada eixo no seu tamanho");
  const mat = a.pivot.children[0].children[0].material;
  const m2 = prepareModel(mk(), { size: { w: 1, h: 1, d: 1 }, material: { rough: 0.85, metal: 0.15, tint: '0x808080', doubleSided: true } }).pivot.children[0].children[0].material;
  ok(mat.metalness === 0.1 && mat.roughness === 0.8 && mat.side === THREE.FrontSide, 'material padrao do jogo: sem metal/brilho de plastico (era metal 1, rugosidade 0)');
  ok(m2.roughness === 0.85 && m2.metalness === 0.15 && m2.side === THREE.DoubleSide && Math.abs(m2.color.r - 0.2158) < 0.01, 'spec.material: rugosidade, metal, lado duplo e tinta aplicados');
  let threw = false; try { prepareModel(new THREE.Group(), {}); } catch { threw = true; }
  ok(threw, 'modelo sem geometria e recusado (cai no prop procedural)');
}

console.log('\n# ModelLibrary: instancias compartilham geometria e material, respeitam a pegada e nunca ampliam');
{
  const lib = new ModelLibrary();
  const g = new THREE.Group(); g.add(mesh(1, 1, 2, 0, 0.5, 0));
  lib.add('cama', prepareModel(g, { size: { w: 1, h: 1, d: 2 } }), { replaces: ['bed:ward', 'bed:bed'] });
  lib.add('outra', prepareModel((() => { const x = new THREE.Group(); x.add(mesh(1, 1, 1, 0, 0, 0)); return x; })(), { size: { w: 1, h: 1, d: 1 } }), { replaces: ['bed:ward', 'x'] });
  ok(lib.size === 2 && lib.has('bed:ward') && lib.has('bed:bed') && lib.has('x') && !lib.has('nada'), 'has() por tipo; o primeiro modelo registrado vence um tipo repetido');
  ok(lib.byKind.get('bed:ward') === 'cama', 'tipo repetido fica com o primeiro');
  const i1 = lib.instance('bed:ward'), i2 = lib.instance('bed:ward');
  const geo = (o) => { let m; o.traverse(x => { if (x.isMesh) m = x; }); return m; };
  ok(i1 !== i2 && geo(i1).geometry === geo(i2).geometry && geo(i1).material === geo(i2).material, 'cada instancia e um objeto novo, mas geometria e material sao compartilhados (so draw calls)');
  i1.position.set(9, 9, 9); ok(i2.position.length() === 0 && lib.templates.get('cama').pivot.position.length() === 0, 'mexer numa instancia nao mexe na outra nem no molde');
  const small = dimsOf(lib.instance('bed:ward', { w: 0.5, d: 0.5 })).s;
  ok(small.x <= 0.5 + 1e-6 && small.z <= 0.5 + 1e-6, `pegada menor (0,5 x 0,5): o modelo encolhe para caber (${small.x.toFixed(2)} x ${small.z.toFixed(2)})`);
  const big = dimsOf(lib.instance('bed:ward', { w: 9, d: 9 })).s;
  ok(Math.abs(big.x - 1) < 1e-6 && Math.abs(big.z - 2) < 1e-6, 'pegada maior: nunca amplia');
  ok(lib.instance('nada') === null, 'tipo desconhecido: null');
  // spec.grow: so para um modelo cuja altura precisa casar com a superficie do prop (o carrinho): deixa passar ate grow x a pegada
  const lg = new ModelLibrary(); const gg = new THREE.Group(); gg.add(mesh(1, 1, 1, 0, 0.5, 0));
  lg.add('g', prepareModel(gg, { size: { w: 1, h: 1, d: 1 } }), { replaces: ['k'], grow: 1.5 });
  const g1 = dimsOf(lg.instance('k', { w: 0.8, d: 0.8 })).s, g2 = dimsOf(lg.instance('k', { w: 0.5, d: 0.5 })).s;
  ok(Math.abs(g1.x - 1) < 1e-6 && Math.abs(g2.x - 0.75) < 1e-6, `spec.grow 1,5: pegada 0,8 -> modelo inteiro (${g1.x.toFixed(2)}); pegada 0,5 -> 0,75 (${g2.x.toFixed(2)}); sem grow nunca passa`);
}

console.log('\n# loadModelLibrary: sem manifesto, sem problema (o jogo segue com os props procedurais)');
{
  const real = globalThis.fetch;
  const run = async (impl) => { globalThis.fetch = impl; try { return await loadModelLibrary('assets/models/manifest.json'); } finally { globalThis.fetch = real; } };
  ok(await run(async () => ({ ok: false, status: 404 })) === null, 'manifesto 404: null');
  ok(await run(async () => { throw new Error('rede'); }) === null, 'erro de rede: null');
  ok(await run(async () => ({ ok: true, json: async () => { throw new Error('json'); } })) === null, 'manifesto com JSON invalido: null');
  ok(await run(async () => ({ ok: true, json: async () => ({ models: {} }) })) === null, 'manifesto vazio: null');
  // modelos reais publicados em assets/models: estrutura confere com os arquivos (o GLB em si so carrega no navegador)
  const mp = path.join(ROOT, 'assets/models/manifest.json');
  const man = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : { models: {} };
  const ids = Object.keys(man.models || {});
  if (!ids.length) console.log('  (sem modelos publicados: o jogo usa so os props procedurais)');
  else {
    const bad = []; let total = 0;
    for (const id of ids) {
      const m = man.models[id], f = path.join(ROOT, 'assets/models', m.file || '');
      if (!m.file || !fs.existsSync(f)) { bad.push(id + ': arquivo ausente'); continue; }
      const buf = fs.readFileSync(f); total += buf.length;
      if (buf.subarray(0, 4).toString() !== 'glTF' || buf.readUInt32LE(8) !== buf.length) bad.push(id + ': cabecalho GLB invalido');
      if (buf.length !== m.bytes) bad.push(id + ': bytes difere do manifesto');
      if (!m.spec?.size || !(m.spec.replaces || []).length) bad.push(id + ': spec sem size/replaces');
      if ((m.textures || []).some(t => t[0] > 1024 || t[1] > 1024)) bad.push(id + ': textura maior que 1024');
      if (m.tris > 40000) bad.push(id + ': triangulos demais');
    }
    ok(!bad.length, `${ids.length} modelos publicados: GLB valido, bytes e spec batem com o manifesto, texturas <= 1024, <= 40 mil triangulos${bad.length ? ' -> ' + bad.join('; ') : ''}`);
    ok(total < 16 * 1048576, `peso total dos modelos publicados abaixo de 16 MB (${(total / 1048576).toFixed(1)} MB)`);
  }
}

console.log('\n# Mundo com modelos: so o VISUAL muda; colisao, navegacao e esconderijos ficam byte a byte iguais');
{
  const Q = { texture: 16, lights: 0, shadow: 16, scale: 1 };
  const base = new World(new THREE.Scene(), Q, () => {}); await base.build();
  const baseSpec = JSON.stringify(extractSpec(base));
  const lib = new ModelLibrary();
  const kinds = { 'bed:ward': 'cama', 'bed:bed': 'cama', wheelchair: 'cadeira', gurney: 'maca', cadaver: 'corpo', autopsyTable: 'mesa', restraint: 'cadeira2', iv: 'soro', cart: 'carrinho' };
  for (const id of new Set(Object.values(kinds))) { const g = new THREE.Group(); g.add(mesh(1.3, 1.1, 2.7, 3, 0.2, 1)); lib.add(id, prepareModel(g, { size: { w: 0.9, h: 1, d: 2 }, keepOverlay: id === 'maca' || id === 'mesa' }), { replaces: Object.entries(kinds).filter(([, v]) => v === id).map(([k]) => k), keepOverlay: id === 'maca' || id === 'mesa' }); }
  const scene = new THREE.Scene();
  const w = new World(scene, Q, () => {}, lib); await w.build();
  ok(JSON.stringify(extractSpec(w)) === baseSpec, `especificacao do servidor (colisao, caixas, esconderijos, dutos, lampadas, itens) IDENTICA com e sem modelos (${baseSpec.length} bytes)`);
  const inst = []; scene.traverse(o => { if (o.userData?.model3d) inst.push(o); });
  const by = {}; for (const o of inst) by[o.userData.model3d] = (by[o.userData.model3d] || 0) + 1;
  ok(by.cama === 15, `15 camas viraram modelos (${by.cama})`);
  ok((by.maca || 0) >= 5 && (by.mesa || 0) === 2 && (by.carrinho || 0) >= 1, `macas (${by.maca}), mesas de autopsia (${by.mesa}) e carrinho (${by.carrinho}) trocados`);
  const glbGroups = scene.children.filter(c => c.userData.glb);
  ok(glbGroups.length === inst.filter(o => o.userData.model3d !== 'corpo').length, `props com modelo ficam FORA da fusao estatica (${glbGroups.length} grupos na cena)`);
  // nenhum modelo passa da caixa de colisao do prop (pegada w x d) -- o grupo ja vem rotacionado: mede no referencial local do grupo
  let over = 0;
  for (const gr of glbGroups) { const m = gr.children.find(c => c.userData.model3d); const bx = new THREE.Box3().setFromObject(m, true); const inv = gr.matrixWorld.clone().invert(); const lb = new THREE.Box3(); for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) lb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv)); const s = lb.getSize(new THREE.Vector3()); if (s.x > 0.95 + 0.05 || s.z > 2.1 + 0.05) over++; }
  ok(over === 0, 'nenhum modelo passa da pegada do prop (maior que 0,95 x 2,1 m)');
  const keep = glbGroups.some(gr => gr.children.some(c => c.userData.overlay));
  ok(keep, 'keepOverlay: o corpo na maca e a bandeja da mesa de autopsia sobrevivem a troca');
  const ovY = (sc) => { const ys = []; for (const gr of sc.children.filter(c => c.userData.glb)) for (const c of gr.children) if (c.userData.overlay) ys.push(+c.position.y.toFixed(3)); return ys; };
  ok(ovY(scene).every(y => y === 0), 'sem overlayY: as partes mantidas ficam onde o prop procedural as pos (y 0)');
  // overlayY: o modelo tem o colchao numa altura diferente da do prop procedural; o corpo sobreposto apoia nele (colisao e servidor nao mudam)
  const libY = new ModelLibrary();
  for (const id of new Set(Object.values(kinds))) { const g = new THREE.Group(); g.add(mesh(1.3, 1.1, 2.7, 3, 0.2, 1)); const sp = { replaces: Object.entries(kinds).filter(([, v]) => v === id).map(([k]) => k), keepOverlay: id === 'maca' || id === 'mesa', ...(id === 'maca' ? { overlayY: -0.24 } : {}) }; libY.add(id, prepareModel(g, { size: { w: 0.9, h: 1, d: 2 } }), sp); }
  const sceneY = new THREE.Scene(); const wY = new World(sceneY, Q, () => {}, libY); await wY.build();
  const macaY = []; for (const gr of sceneY.children.filter(c => c.userData.glb)) if (gr.children.some(c => c.userData.model3d === 'maca')) for (const c of gr.children) if (c.userData.overlay) macaY.push(+c.position.y.toFixed(3));
  ok(macaY.length >= 5 && macaY.every(y => y === -0.24), `overlayY -0,24: o corpo de todas as macas (${macaY.length}) desce para o colchao do modelo`);
  ok(JSON.stringify(extractSpec(wY)) === baseSpec, 'overlayY nao altera a especificacao do servidor (continua identica)');
  const noMatch = new ModelLibrary(); noMatch.add('x', prepareModel((() => { const g = new THREE.Group(); g.add(mesh(1, 1, 1, 0, 0, 0)); return g; })(), {}), { replaces: ['nada'] });
  const s2 = new THREE.Scene(); const w2 = new World(s2, Q, () => {}, noMatch); await w2.build();
  ok(s2.children.filter(c => c.userData.glb).length === 0 && JSON.stringify(extractSpec(w2)) === baseSpec, 'biblioteca sem tipos que casem: nada muda');
}

console.log('\n# process.py: valida (dado nao confiavel), reduz textura e publica');
const py = spawnSync('python', ['-c', 'import PIL']);
if (py.status !== 0) console.log('  (sem Python/Pillow: etapa pulada)');
else {
  const gl = (buf) => { const jl = buf.readUInt32LE(12); return { json: JSON.parse(buf.toString('utf8', 20, 20 + jl)), rest: buf.subarray(20 + jl) }; };
  const writeGl = (json, rest) => { let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]); const total = 12 + 8 + js.length + rest.length; const h = Buffer.alloc(20); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8); h.writeUInt32LE(js.length, 12); h.writeUInt32LE(0x4E4F534A, 16); return Buffer.concat([h, js, rest]); };
  const raw = tmp(), out = tmp();
  const put = (id, buf) => { fs.mkdirSync(path.join(raw, id), { recursive: true }); fs.writeFileSync(path.join(raw, id, 'model.glb'), buf); };
  const good = fs.readFileSync(path.join(FIX, 'raw/hospital_bed/model.glb'));
  put('hospital_bed', good);
  put('wheelchair', good.subarray(0, 5000));                                                       // truncado
  { const { json, rest } = gl(good); json.extensionsRequired = ['KHR_draco_mesh_compression']; put('gurney', writeGl(json, rest)); }   // exige decodificador que o jogo nao tem
  { const { json, rest } = gl(good); json.images[0].uri = 'http://example.com/x.png'; delete json.images[0].bufferView; put('covered_body', writeGl(json, rest)); }   // imagem externa
  const r = spawnSync('python', ['-I', path.join(ROOT, 'tools/tripo/process.py')], { env: { ...process.env, TRIPO_RAW_DIR: raw, TRIPO_OUT_DIR: out }, encoding: 'utf8' });
  const txt = r.stdout + r.stderr;
  ok(/\+ hospital_bed: .*-> .* MB; texturas 2048x2048->1024x1024/.test(txt), 'modelo bom: processado e textura reduzida de 2048 para 1024');
  ok(/! wheelchair: REJEITADO/.test(txt), 'GLB truncado: rejeitado');
  ok(/! gurney: REJEITADO.*decodificador/.test(txt), 'extensao obrigatoria sem decodificador no jogo (draco): rejeitada');
  ok(/! covered_body: REJEITADO.*URI/.test(txt), 'imagem com URI externa: rejeitada');
  const files = fs.readdirSync(out).sort();
  ok(files.join(',') === 'hospital_bed.glb,manifest.json', `so o modelo bom foi publicado (${files.join(', ')})`);
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const m = man.models.hospital_bed;
  ok(m && m.bytes < good.length / 2 && m.tris === 96 && m.textures[0][0] === 1024 && m.spec.replaces.includes('bed:ward') && m.spec.size.d === 2.05, `manifesto: ${m?.tris} tri, ${(m?.bytes / 1024).toFixed(0)} KB (era ${(good.length / 1024).toFixed(0)} KB), spec do jogo junto`);
  const rb = spawnSync('python', ['-I', path.join(ROOT, 'tools/tripo/process.py'), '--check-only', 'hospital_bed'], { env: { ...process.env, TRIPO_RAW_DIR: raw, TRIPO_OUT_DIR: path.join(out, 'nao-escrever') }, encoding: 'utf8' });
  ok(rb.status === 0 && !fs.existsSync(path.join(out, 'nao-escrever')), '--check-only so relata, nao escreve nada');
}

console.log('\n# Executor da API (run.mjs) contra um Tripo FALSO local: custo, parada por saldo, sem pagar duas vezes, sem vazar a chave');
{
  const KEY = 'tsk_SECRET_test_key_123';
  const GLB = fs.readFileSync(path.join(FIX, 'raw/wheelchair/model.glb'));
  const mock = async (opts) => {
    const st = { credits: opts.credits, cost: opts.cost ?? 30, posts: [], badAuth: 0, tasks: new Map(), n: 0 };
    const srv = http.createServer((req, res) => {
      const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const u = req.url;
      if (u.includes('/files/')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(st.bad ? Buffer.from('nao e um glb') : GLB); }     // URL assinada e publica: sem Authorization
      if (req.headers.authorization !== 'Bearer ' + KEY) { st.badAuth++; return send({ code: 1002, message: 'auth' }, 401); }
      if (u.endsWith('/user/balance')) return send({ code: 0, data: { balance: st.credits, frozen: 0 } });
      if (req.method === 'POST' && u.endsWith('/task')) {
        let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
          const body = JSON.parse(b); st.posts.push(body);
          if (opts.rejectExtra && 'negative_prompt' in body) return send({ code: 1004, message: 'invalid parameter negative_prompt' }, 400);
          if (opts.leak) return send({ code: 9999, message: 'falha estranha com a chave ' + KEY }, 500);
          if (st.credits < st.cost) return send({ code: 2010, message: "You don't have enough credit to create this task" });
          st.credits -= st.cost; const id = 't' + (++st.n); st.tasks.set(id, 0); send({ code: 0, data: { task_id: id } });
        }); return;
      }
      const m = u.match(/\/task\/(t\d+)$/);
      if (m) { const n = (st.tasks.get(m[1]) || 0) + 1; st.tasks.set(m[1], n); return send({ code: 0, data: n < 2 ? { status: 'running', progress: 40 } : { status: 'success', progress: 100, output: { model: `http://127.0.0.1:${srv.address().port}/files/${m[1]}.glb` } } }); }
      send({ code: 404, message: 'x' }, 404);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); st.srv = srv; st.port = srv.address().port; return st;
  };
  const manifest = (ids) => ({ style: 'estilo', negative: 'neg', defaults: { face_limit: 5000, texture: true, pbr: false, texture_quality: 'standard' }, assets: ids.map((id, i) => ({ id, priority: i + 1, prompt: 'p ' + id, why: 'w', size: { w: 1, h: 1, d: 1 } })) });
  const exec = (st, work, mf, args = [], env = {}) => new Promise(resolve => {
    fs.writeFileSync(path.join(work, 'mf.json'), JSON.stringify(manifest(mf)));
    const p = spawn(process.execPath, [path.join(ROOT, 'tools/tripo/run.mjs'), ...args], { env: { ...process.env, TRIPO_API_KEY: KEY, TRIPO_API_BASE: `http://127.0.0.1:${st.port}/v2/openapi`, TRIPO_WORK_DIR: work, TRIPO_MANIFEST: path.join(work, 'mf.json'), TRIPO_POLL_MS: '10', ...env } });
    let out = ''; p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (out += d)); p.on('close', code => resolve({ code, out }));
  });
  const stateOf = (work) => JSON.parse(fs.readFileSync(path.join(work, 'state.json'), 'utf8'));

  // A) saldo para 2 de 3: gera 2, mede o custo e PARA antes de tentar o terceiro (nao gasta o que nao cobre)
  { const st = await mock({ credits: 70 }), work = tmp();
    const r = await exec(st, work, ['a', 'b', 'c'], ['generate']);
    const s = stateOf(work);
    ok(r.code === 0 && st.posts.length === 2 && s.assets.a.status === 'downloaded' && s.assets.b.status === 'downloaded' && !s.assets.c, `saldo 70, custo 30: gera 2 de 3 e para antes do terceiro (${st.posts.length} POST /task)`);
    ok(s.assets.a.credits === 30 && s.assets.b.credits === 30 && st.credits === 10, 'mede o custo real de cada asset pelo saldo (30 e 30)');
    ok(fs.readFileSync(path.join(work, 'raw/a/model.glb')).subarray(0, 4).toString() === 'glTF', 'GLB baixado na quarentena (raw/<id>/model.glb)');
    ok(st.posts[0].type === 'text_to_model' && st.posts[0].prompt.includes('p a') && st.posts[0].prompt.includes('estilo') && st.posts[0].negative_prompt === 'neg' && st.posts[0].face_limit === 5000 && st.posts[0].pbr === false, 'corpo da requisicao: prompt do asset + estilo do jogo, negativo, face_limit, pbr desligado');
    ok(!r.out.includes(KEY), 'a chave nunca aparece na saida');
    // B) recarregou: continua so do que falta (nao regera a e b)
    st.credits = 100;
    const r2 = await exec(st, work, ['a', 'b', 'c'], ['generate']);
    ok(r2.code === 0 && st.posts.length === 3 && stateOf(work).assets.c.status === 'downloaded' && /= a: ja baixado/.test(r2.out), 'segunda rodada: so gera o que faltava (a e b NAO sao regerados; 3 POST no total)');
    // F) --force refaz um so
    const r3 = await exec(st, work, ['a', 'b', 'c'], ['generate', '--force', 'b']);
    ok(st.posts.length === 4 && /\+ b/.test(r3.out), '--force id refaz so aquele (4 POST no total)');
    st.srv.close(); }
  // C) --max-assets
  { const st = await mock({ credits: 500 }), work = tmp();
    await exec(st, work, ['a', 'b', 'c'], ['generate', '--max-assets', '1']);
    ok(st.posts.length === 1, '--max-assets 1: gera so um'); st.srv.close(); }
  // D) --max-credits
  { const st = await mock({ credits: 500 }), work = tmp();
    await exec(st, work, ['a', 'b', 'c', 'd'], ['generate', '--max-credits', '70']);
    const spentTotal = Object.values(stateOf(work).assets).reduce((x, a) => x + (a.credits || 0), 0);
    ok(st.posts.length === 2 && spentTotal <= 70 && !stateOf(work).assets.c, `--max-credits 70: gasta 60 e para (um terceiro custaria 90): o limite nunca e ultrapassado (${st.posts.length} POST, ${spentTotal} creditos)`); st.srv.close(); }
  // E) saldo zero: nao tenta gerar nada
  { const st = await mock({ credits: 0 }), work = tmp();
    const r = await exec(st, work, ['a'], ['generate']);
    ok(r.code === 3 && st.posts.length === 0 && /Sem credito/.test(r.out), 'saldo 0: sai com aviso claro e NAO chama /task'); st.srv.close(); }
  // G) sem chave
  { const st = await mock({ credits: 100 }), work = tmp();
    const r = await exec(st, work, ['a'], ['generate'], { TRIPO_API_KEY: '' });
    ok(r.code !== 0 && /TRIPO_API_KEY/.test(r.out) && st.posts.length === 0, 'sem TRIPO_API_KEY: recusa e nao faz nenhuma chamada'); st.srv.close(); }
  // H) parametro recusado pela API: tenta de novo so com o essencial
  { const st = await mock({ credits: 100, rejectExtra: true }), work = tmp();
    const r = await exec(st, work, ['a'], ['generate']);
    ok(st.posts.length === 2 && Object.keys(st.posts[1]).sort().join() === 'prompt,type' && stateOf(work).assets.a.status === 'downloaded', 'API recusa um parametro: repete so com type + prompt e conclui'); st.srv.close(); }
  // I) erro com a chave dentro da mensagem: sai mascarada
  { const st = await mock({ credits: 100, leak: true }), work = tmp();
    const r = await exec(st, work, ['a'], ['generate']);
    ok(!r.out.includes(KEY) && /\*\*\*/.test(r.out), 'mensagem de erro da API que contem a chave e mascarada (***)'); st.srv.close(); }
  // J) arquivo baixado que nao e GLB
  { const st = await mock({ credits: 100 }); st.bad = true; const work = tmp();
    const r = await exec(st, work, ['a'], ['generate']);
    ok(stateOf(work).assets.a.status === 'failed' && /nao parece um GLB/.test(r.out) && !fs.existsSync(path.join(work, 'raw/a/model.glb')), 'download que nao e um GLB valido: recusado, nada gravado'); st.srv.close(); }
  // plan: nao gasta
  { const st = await mock({ credits: 100 }), work = tmp();
    const r = await exec(st, work, ['a', 'b'], ['plan']);
    ok(st.posts.length === 0 && /saldo: 100/.test(r.out) && /2 asset\(s\) a gerar/.test(r.out), 'plan: mostra saldo e o que seria gerado, sem gastar'); st.srv.close(); }
}

console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
