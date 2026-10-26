// Clonagem de voz LOCAL no navegador (Web Worker): Kyutai "Pocket TTS" (100 M parametros, pesos CC-BY-4.0) em ONNX/int8.
//   amostra da voz (PCM 24 kHz) -> codificador Mimi -> "estado de voz" -> texto em portugues -> fala NA VOZ DA AMOSTRA.
// Isto e clonagem de verdade (gera frases novas), nao reproducao de gravacao. Nada sai do worker alem do audio ja sintetizado.
//
// Adaptado de hemanth/pocket-voice (MIT) e KevinAHM/pocket-tts-web (Apache-2.0); exportacao ONNX por KevinAHM. Ver vendor/NOTICE.md.
// Mudancas aqui: bases de URL configuraveis, sem vozes embutidas (nao baixa voices.bin), download com progresso,
// uma unica chamada `synthesize` que devolve o clipe inteiro, e nenhum codigo de terceiros carregado de CDN (ORT e sentencepiece sao locais).

let ORT_BASE = '', SP_URL = '', MODEL_BASE = '';
const MODEL_FILES = {
  mimi_encoder: 'mimi_encoder_int8.onnx', text_conditioner: 'text_conditioner_int8.onnx',
  flow_lm_main: 'flow_lm_main_int8.onnx', flow_lm_flow: 'flow_lm_flow_int8.onnx', mimi_decoder: 'mimi_decoder_int8.onnx',
};
const MAX_FRAMES = 300, LSD_STEPS = 1;
// Frases curtas: o detector de fim do modelo dispara cedo demais e corta a fala no meio. Por isso (a) exigimos um minimo de quadros
// proporcional ao texto e (b) so paramos quando o final do audio ja esta em decaimento (ou depois de MAX_EXTRA quadros extras).
const MIN_FRAMES_BASE = 4, MIN_FRAMES_PER_CHAR = 0.45, TAIL_OK = 0.15, MAX_EXTRA = 8;

let bundleMetadata = null, tokenizerProcessor = null, bosBeforeVoice = null;
let sessions = {}, stTensors = [];
let sampleRate = 24000, samplesPerFrame = 1920, latentDim = 32, conditioningDim = 1024, maxTokenPerChunk = 50;
let customVoiceEmbedding = null, voiceCache = null;
let isReady = false, isGenerating = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const createTensor = (dtype, data, dims) => new ort.Tensor(dtype, data, dims);

function makeFilledArray(shape, dtype, fill) {
  const size = shape.reduce((a, b) => a * b, 1);
  if (dtype === 'int64') return new BigInt64Array(size);
  if (dtype === 'bool') return new Uint8Array(size);
  const data = new Float32Array(size);
  if (fill === 'nan') data.fill(NaN); else if (fill === 'ones') data.fill(1);
  return data;
}
function initStateFromManifest(manifest) {
  const state = {};
  for (const e of manifest) state[e.input_name] = createTensor(e.dtype, makeFilledArray(e.shape, e.dtype, e.fill), e.shape);
  return state;
}
const cloneState = (s) => ({ ...s });
function updateStateFromManifestOutputs(state, result, manifest) { for (const e of manifest) state[e.input_name] = result[e.output_name]; }

// ---------- carregamento ----------
async function fetchBuf(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar ${url.split('/').pop()} (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !onBytes) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(value.length, total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function parseNpyFloat32(buffer) {
  const view = new DataView(buffer);
  const major = view.getUint8(6);
  const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerOffset = major === 1 ? 10 : 12;
  const headerText = new TextDecoder().decode(new Uint8Array(buffer, headerOffset, headerLen));
  const m = headerText.match(/\(\s*([0-9,\s]+)\)/);
  if (!m) throw new Error('NPY invalido');
  const shape = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => parseInt(s, 10));
  return { data: new Float32Array(new Float32Array(buffer, headerOffset + headerLen)), shape };
}

async function loadAll(cfg) {
  ORT_BASE = cfg.ortBase; SP_URL = cfg.spUrl; MODEL_BASE = cfg.modelBase.replace(/\/+$/, '');
  importScripts(ORT_BASE + 'ort.min.js');
  ort.env.wasm.wasmPaths = ORT_BASE; ort.env.logLevel = 'error';
  ort.env.wasm.simd = true; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;     // GitHub Pages nao e "cross-origin isolated": 1 thread
  const base = `${MODEL_BASE}/${cfg.language}`;
  bundleMetadata = await (await fetch(`${base}/bundle.json`)).json();
  sampleRate = +bundleMetadata.sample_rate; samplesPerFrame = +bundleMetadata.samples_per_frame;
  latentDim = +bundleMetadata.latent_dim; conditioningDim = +bundleMetadata.conditioning_dim; maxTokenPerChunk = +(bundleMetadata.max_token_per_chunk || 50);
  // baixa os modelos com progresso (o navegador guarda em cache: da segunda vez e instantaneo)
  const sizes = cfg.sizes || {};
  const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0) || 146e6;
  let got = 0, lastPost = 0;
  const bytes = {};
  for (const [k, file] of Object.entries(MODEL_FILES)) {
    bytes[k] = await fetchBuf(`${base}/${file}`, (n) => { got += n; const now = performance.now(); if (now - lastPost > 100) { lastPost = now; post({ type: 'progress', loaded: got, total: totalBytes }); } });
  }
  post({ type: 'status', status: 'Preparando o modelo…' });
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  for (const k of Object.keys(MODEL_FILES)) { sessions[k] = await ort.InferenceSession.create(bytes[k], opts); bytes[k] = null; }
  const tok = await (await fetch(`${base}/${bundleMetadata.tokenizer_file}`)).arrayBuffer();
  importScripts(SP_URL);
  tokenizerProcessor = new self.SentencePieceProcessor();
  await tokenizerProcessor.loadFromArrayBuffer(tok);
  bosBeforeVoice = null;
  if (bundleMetadata.bos_before_voice_file) { const r = await fetch(`${base}/${bundleMetadata.bos_before_voice_file}`); if (r.ok) bosBeforeVoice = parseNpyFloat32(await r.arrayBuffer()); }
  stTensors = [];
  for (let step = 0; step < LSD_STEPS; step++) { const s = step / LSD_STEPS, t = s + 1 / LSD_STEPS; stTensors.push({ s: createTensor('float32', new Float32Array([s]), [1, 1]), t: createTensor('float32', new Float32Array([t]), [1, 1]) }); }
  isReady = true;
}

// ---------- voz ----------
function prepareVoiceEmbeddingData(voiceEmb) {
  let data = voiceEmb.data, dims = voiceEmb.shape.slice();
  if (bundleMetadata.insert_bos_before_voice && bosBeforeVoice) {
    const combined = new Float32Array(bosBeforeVoice.data.length + data.length);
    combined.set(bosBeforeVoice.data, 0); combined.set(data, bosBeforeVoice.data.length);
    data = combined; dims = [1, dims[1] + bosBeforeVoice.shape[1], dims[2]];
  }
  return createTensor('float32', data, dims);
}

async function encodeVoice(audio) {
  const out = await sessions.mimi_encoder.run({ audio: createTensor('float32', audio, [1, 1, audio.length]) });
  const emb = out[sessions.mimi_encoder.outputNames[0]];
  let dims = emb.dims.slice();
  const data = new Float32Array(emb.data);
  while (dims.length > 3 && dims[0] === 1) dims = dims.slice(1);
  if (dims.length < 3) dims = [1, dims[0], dims[1]];
  customVoiceEmbedding = { data, shape: dims };
  const state = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);
  const empty = createTensor('float32', new Float32Array(0), [1, 0, latentDim]);
  const result = await sessions.flow_lm_main.run({ sequence: empty, text_embeddings: prepareVoiceEmbeddingData(customVoiceEmbedding), ...state });
  updateStateFromManifestOutputs(state, result, bundleMetadata.flow_lm_state_manifest);
  voiceCache = state;
}

// ---------- texto ----------
function prepareTextPrompt(text) {
  let prompt = text.trim();
  if (!prompt) return { text: '', framesAfterEos: 1 };
  prompt = prompt.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
  if (bundleMetadata.remove_semicolons) prompt = prompt.replace(/;/g, ',');
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  let framesAfterEos = wordCount <= 4 ? 3 : 1;
  if (bundleMetadata.model_recommended_frames_after_eos != null) framesAfterEos = Number(bundleMetadata.model_recommended_frames_after_eos);
  if (prompt && !/[A-ZÀ-Þ]/.test(prompt[0])) prompt = prompt[0].toUpperCase() + prompt.slice(1);
  if (prompt && /[0-9A-Za-zÀ-ÿ]/.test(prompt[prompt.length - 1])) prompt += '.';
  if (bundleMetadata.pad_with_spaces_for_short_inputs && wordCount < 5) prompt = '        ' + prompt;
  return { text: prompt, framesAfterEos };
}

async function synthesize(id, text, opt = {}) {
  if (!voiceCache) throw new Error('Nenhuma voz carregada.');
  const prepared = prepareTextPrompt(text);
  if (!prepared.text) throw new Error('Texto vazio.');
  const framesAfterEos = opt.after ?? prepared.framesAfterEos;
  const minFrames = opt.minFrames ?? Math.round(MIN_FRAMES_BASE + MIN_FRAMES_PER_CHAR * prepared.text.trim().length);
  const baseFlowState = voiceCache;
  let mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
  const emptySeq = createTensor('float32', new Float32Array(0), [1, 0, latentDim]);
  const emptyText = createTensor('float32', new Float32Array(0), [1, 0, conditioningDim]);
  const flowLmState = cloneState(baseFlowState);
  const ids = tokenizerProcessor.encodeIds(prepared.text);
  let textEmb = (await sessions.text_conditioner.run({ token_ids: createTensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) }))[sessions.text_conditioner.outputNames[0]];
  if (textEmb.dims.length === 2) textEmb = createTensor('float32', new Float32Array(textEmb.data), [1, textEmb.dims[0], textEmb.dims[1]]);
  const cond = await sessions.flow_lm_main.run({ sequence: emptySeq, text_embeddings: textEmb, ...flowLmState });
  updateStateFromManifestOutputs(flowLmState, cond, bundleMetadata.flow_lm_state_manifest);

  const pcmParts = []; const latents = []; let peakRms = 1e-6, lastRms = 0, extra = 0;
  let current = createTensor('float32', new Float32Array(latentDim).fill(NaN), [1, 1, latentDim]);
  let eosStep = null, decoded = 0;
  const decodeUpTo = async (n) => {
    if (n <= decoded) return;
    const lat = new Float32Array((n - decoded) * latentDim);
    for (let f = decoded; f < n; f++) lat.set(latents[f], (f - decoded) * latentDim);
    const r = await sessions.mimi_decoder.run({ latent: createTensor('float32', lat, [1, n - decoded, latentDim]), ...mimiState });
    for (const e of bundleMetadata.mimi_state_manifest) mimiState[e.input_name] = r[e.output_name];
    const part = new Float32Array(r[sessions.mimi_decoder.outputNames[0]].data);
    pcmParts.push(part);
    for (let s = 0; s + samplesPerFrame <= part.length; s += samplesPerFrame) { let e = 0; for (let i = 0; i < samplesPerFrame; i++) e += part[s + i] * part[s + i]; lastRms = Math.sqrt(e / samplesPerFrame); peakRms = Math.max(peakRms, lastRms); }
    decoded = n;
  };
  for (let step = 0; step < MAX_FRAMES; step++) {
    if (!isGenerating) throw new Error('Cancelado.');
    if (step % 4 === 0) await new Promise(r => setTimeout(r, 0));
    const ar = await sessions.flow_lm_main.run({ sequence: current, text_embeddings: emptyText, ...flowLmState });
    const isEos = ar.eos_logit.data[0] > -4.0;
    if (isEos && eosStep == null) eosStep = step;
    const std = Math.sqrt(0.7), lat = new Float32Array(latentDim);
    for (let i = 0; i < latentDim; i++) { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); lat[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std; }
    for (let k = 0; k < LSD_STEPS; k++) {
      const fr = await sessions.flow_lm_flow.run({ c: ar.conditioning, s: stTensors[k].s, t: stTensors[k].t, x: createTensor('float32', lat, [1, latentDim]) });
      for (let i = 0; i < latentDim; i++) lat[i] += fr.flow_dir.data[i] / LSD_STEPS;
    }
    latents.push(new Float32Array(lat));
    current = createTensor('float32', lat, [1, 1, latentDim]);
    updateStateFromManifestOutputs(flowLmState, ar, bundleMetadata.flow_lm_state_manifest);
    if (eosStep != null && step >= Math.max(eosStep + framesAfterEos, minFrames)) {
      await decodeUpTo(latents.length);
      if (lastRms / peakRms <= TAIL_OK || extra++ >= MAX_EXTRA) break;      // terminou com o som ja apagando (nao cortado no meio)
    }
  }
  await decodeUpTo(latents.length);
  const total = pcmParts.reduce((a, p) => a + p.length, 0), pcm = new Float32Array(total);
  let o = 0; for (const p of pcmParts) { pcm.set(p, o); o += p.length; }
  return { pcm, tail: lastRms / peakRms };        // tail: 0 = terminou em silencio, ~1 = cortado no meio do som
}

// ---------- mensagens ----------
self.onmessage = async (e) => {
  const { type, data, id } = e.data;
  try {
    if (type === 'init') { await loadAll(data); post({ type: 'ready', id, sampleRate }); }
    else if (type === 'wipe') { customVoiceEmbedding = null; voiceCache = null; post({ type: 'wiped' }); }     // apaga a voz da memoria (revogar / fim)
    else if (!isReady) post({ type: 'error', id, error: 'Modelo ainda nao carregado.' });
    else if (type === 'encode') { await encodeVoice(data.audio); post({ type: 'encoded', id }); }
    else if (type === 'synthesize') {
      if (isGenerating) { post({ type: 'error', id, error: 'Ocupado.' }); return; }
      isGenerating = true;
      const t0 = performance.now();
      try { const { pcm, tail } = await synthesize(id, data.text, data); post({ type: 'clip', id, pcm, tail, sr: sampleRate, ms: performance.now() - t0 }, [pcm.buffer]); }
      finally { isGenerating = false; }
    } else if (type === 'stop') isGenerating = false;
  } catch (err) { isGenerating = false; post({ type: 'error', id, error: String(err && err.message || err) }); }
};
