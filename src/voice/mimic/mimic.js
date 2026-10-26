// "O Noturno imita a voz de um jogador" — recurso OPCIONAL, com autorizacao especifica de quem cede a voz.
//
//  1. Consentimento explicito (a permissao do chat de voz NAO vale aqui).
//  2. A amostra (leitura de uma frase, ~10 s) e gravada e processada SO no navegador de quem cede a voz e apagada logo em seguida.
//  3. Um modelo local (Pocket TTS, ver pocket-worker.js) GERA frases novas em portugues na voz da amostra (isto e clonagem, nao gravacao).
//  4. So as 5 frases curtas ja sintetizadas sao enviadas a sala (memoria do servidor, apagadas ao fim da partida).
//  5. Na partida o SERVIDOR decide quando/quem/qual frase; cada cliente toca o clipe (com efeito sombrio) a partir da posicao da criatura.
// Se estiver desligado, sem amostra valida, ou algo falhar, o jogo segue normalmente.
import { MIMIC } from '../../shared/coop.js';

export const HF_MODEL_BASE = 'https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main/onnx';
export const MODEL_SIZES = { mimi_encoder: 20.8e6, text_conditioner: 16.4e6, flow_lm_main: 76.3e6, flow_lm_flow: 10e6, mimi_decoder: 22.7e6 };
export const SAMPLE_TEXT = 'Boa noite. Eu estou procurando os fusíveis para religar a energia do hospital. Se você me ouvir, venha até o quadro geral, perto da recepção.';
export const UPLOAD_SR = 16000;

const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

// PCM float -> int16 base64 e de volta
export function pcmToB64(f32) { const i16 = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767; return bytesToB64(new Uint8Array(i16.buffer)); }
export function b64ToPcm(b64) { const u8 = b64ToBytes(b64); const i16 = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1); const f = new Float32Array(i16.length); for (let i = 0; i < f.length; i++) f[i] = i16[i] / 32767; return f; }

// reamostra PCM mono (OfflineAudioContext faz o filtro certo)
export async function resample(pcm, from, to) {
  if (from === to) return pcm;
  const src = new OfflineAudioContext(1, pcm.length, from).createBuffer(1, pcm.length, from); src.getChannelData(0).set(pcm);
  const off = new OfflineAudioContext(1, Math.ceil(pcm.length * to / from), to);
  const s = off.createBufferSource(); s.buffer = src; s.connect(off.destination); s.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

// ---------- validacao da amostra ----------
export function checkSample(pcm, sr = 24000) {
  const sec = pcm.length / sr;
  if (sec < 5) return { ok: false, why: `Muito curta (${sec.toFixed(1)} s): leia a frase inteira.` };
  if (sec > 25) return { ok: false, why: 'Muito longa: grave só a frase.' };
  const fr = Math.floor(sr * 0.03), rms = [];
  let clip = 0;
  for (let s = 0; s + fr <= pcm.length; s += fr) { let e = 0; for (let i = 0; i < fr; i++) { const v = pcm[s + i]; e += v * v; if (Math.abs(v) > 0.985) clip++; } rms.push(Math.sqrt(e / fr)); }
  const sorted = [...rms].sort((a, b) => a - b);
  const voiced = rms.filter(r => r > 0.012).length / rms.length;
  const noise = sorted[Math.floor(sorted.length * 0.15)] + 1e-6, speech = sorted[Math.floor(sorted.length * 0.9)] + 1e-6;
  if (speech < 0.03) return { ok: false, why: 'Não consegui ouvir sua voz: fale mais perto do microfone.' };
  if (voiced < 0.35) return { ok: false, why: 'Quase só silêncio na gravação: leia a frase em voz normal, sem pausas longas.' };
  if (clip / pcm.length > 0.01) return { ok: false, why: 'A gravação estourou (som distorcido): fale mais baixo ou afaste o microfone.' };
  if (20 * Math.log10(speech / noise) < 9) return { ok: false, why: 'Muito ruído de fundo: procure um lugar mais silencioso.' };
  return { ok: true, sec, voiced };
}

// corta o silencio das pontas (deixa ~60 ms) e limita a duracao para caber nos limites do servidor
export function trimClip(pcm, sr, maxSec = 3.4) {
  let a = 0, b = pcm.length; const th = 0.006;
  while (a < b && Math.abs(pcm[a]) < th) a++;
  while (b > a && Math.abs(pcm[b - 1]) < th) b--;
  a = Math.max(0, a - Math.round(sr * 0.06)); b = Math.min(pcm.length, b + Math.round(sr * 0.08));
  const out = pcm.slice(a, Math.min(b, a + Math.round(maxSec * sr)));
  const f = Math.min(out.length >> 1, Math.round(sr * 0.03));                 // fade curto no fim: sem estalo
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
  return out;
}

// ---------- efeito sombrio (pre-renderizado uma vez por clipe) ----------
// suave de proposito: voz mais grave e lenta, um pouco abafada, com tremor e eco escuro — ainda inteligivel e reconhecivel
export const DARK = { rate: 0.9, lowpass: 6800, shelf: 3.5, dip: -3, dipHz: 3300, drive: 1.5, driveMix: 0.28, sub: 0.22, tremHz: 5.5, tremDepth: 0.16, wet: 0.3, ir: 1.0 };

export async function darkenClip(buf, cfg = DARK, sr = 24000) {
  const len = Math.ceil(buf.duration / cfg.rate * sr + sr * (cfg.ir + 0.2));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource(); src.buffer = buf; src.playbackRate.value = cfg.rate;
  const shelf = off.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 220; shelf.gain.value = cfg.shelf;
  const dip = off.createBiquadFilter(); dip.type = 'peaking'; dip.frequency.value = cfg.dipHz; dip.Q.value = 1.1; dip.gain.value = cfg.dip;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cfg.lowpass; lp.Q.value = 0.7;
  src.connect(shelf); shelf.connect(dip); dip.connect(lp);
  // saturacao em paralelo (aspereza sem destruir a voz)
  const sh = off.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; c[i] = Math.tanh(x * cfg.drive * 2) / Math.tanh(cfg.drive * 2); } sh.curve = c;
  const dry = off.createGain(); dry.gain.value = 1 - cfg.driveMix; const drv = off.createGain(); drv.gain.value = cfg.driveMix;
  lp.connect(dry); lp.connect(sh); sh.connect(drv);
  // sub-harmonica: a mesma voz uma oitava abaixo, bem baixinho (rosnado)
  const sub = off.createBufferSource(); sub.buffer = buf; sub.playbackRate.value = cfg.rate * 0.5;
  const subLp = off.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 500; const subG = off.createGain(); subG.gain.value = cfg.sub;
  sub.connect(subLp); subLp.connect(subG);
  // tremor lento
  const trem = off.createGain(); trem.gain.value = 1 - cfg.tremDepth / 2;
  const lfo = off.createOscillator(); lfo.frequency.value = cfg.tremHz; const lg = off.createGain(); lg.gain.value = cfg.tremDepth / 2; lfo.connect(lg); lg.connect(trem.gain);
  dry.connect(trem); drv.connect(trem); subG.connect(trem);
  // eco escuro (reverb curto e opaco)
  const ir = off.createBuffer(1, Math.floor(sr * cfg.ir), sr), d = ir.getChannelData(0); let lpv = 0;
  for (let i = 0; i < d.length; i++) { lpv = lpv * 0.86 + (Math.random() * 2 - 1) * 0.14; d[i] = lpv * Math.pow(1 - i / d.length, 2.6); }
  const conv = off.createConvolver(); conv.buffer = ir; const wet = off.createGain(); wet.gain.value = cfg.wet;
  const out = off.createGain(); out.gain.value = 1;
  trem.connect(out); trem.connect(conv); conv.connect(wet); wet.connect(out); out.connect(off.destination);
  src.start(); sub.start(); lfo.start();
  const r = await off.startRendering();
  // normaliza o pico para nao ficar mais alto que a voz original e corta o silencio do fim
  const dd = r.getChannelData(0); let peak = 0; for (let i = 0; i < dd.length; i++) peak = Math.max(peak, Math.abs(dd[i]));
  let end = dd.length; while (end > 0 && Math.abs(dd[end - 1]) < 0.012 * peak) end--;
  const outBuf = new OfflineAudioContext(1, Math.max(1, end), sr).createBuffer(1, Math.max(1, end), sr);
  const k = peak > 0 ? 0.85 / peak : 1; const od = outBuf.getChannelData(0); for (let i = 0; i < end; i++) od[i] = dd[i] * k;
  return outBuf;
}

// ---------- cliente ----------
export class MimicClient {
  // deps: { audio (Audio do jogo), send(obj), ui: { set(step, info) }, getSample?: async () => Float32Array@24k (teste), worker?: Worker (teste), assets?: {ortBase, spUrl, modelBase} }
  constructor(deps) {
    Object.assign(this, deps);
    this.state = 'off';              // off | consent | downloading | recording | processing | uploading | ready | error
    this.owners = new Set();         // ids que cederam a voz (inclusive eu)
    this.clips = new Map();          // id -> Map(i -> AudioBuffer ja com efeito)
    this.me = null; this.worker = deps.worker || null; this.pending = new Map(); this.nextId = 1;
    this.stats = { plays: 0 };
  }

  get supported() { return typeof Worker !== 'undefined' && typeof OfflineAudioContext !== 'undefined' && typeof WebAssembly === 'object'; }
  _ui(step, info = {}) { this.state = step; this.ui?.set(step, info); }

  // ---- fluxo do dono da voz ----
  // O consentimento em si e dado na interface (botao "Autorizo"); aqui so roda depois dele.
  async run() {
    if (!this.supported) { this._ui('error', { msg: 'Este navegador não suporta o modelo de voz local.' }); return false; }
    this._cancelled = false;
    try {
      await this._ensureWorker();
      this._chk();
      let pcm = null, warn = null;
      for (let attempt = 0; attempt < 3 && !pcm; attempt++) {
        this._ui('recording', { text: SAMPLE_TEXT, attempt, warn, live: false });
        const sample = await (this.getSample ? this.getSample() : this._recordSample());
        this._chk();
        const chk = checkSample(sample, 24000);
        if (chk.ok) pcm = sample; else warn = chk.why;
      }
      if (!pcm) { this._ui('error', { msg: 'Sem uma amostra válida o recurso fica desligado. O jogo continua normalmente.' }); this.wipe(); return false; }
      this._ui('processing', { msg: 'Aprendendo a sua voz (no seu navegador)…', done: 0, total: MIMIC.phrases.length });
      await this._call('encode', { audio: pcm }, [pcm.buffer]);
      pcm = null;                                            // a gravacao bruta some daqui: fica so o "estado de voz" dentro do worker
      this._chk();
      this.send({ t: 'mimic', op: 'on' });
      this.owners.add(this.me);
      const t0 = performance.now();
      for (let i = 0; i < MIMIC.phrases.length; i++) {
        this._ui('processing', { msg: `Gerando fala ${i + 1}/${MIMIC.phrases.length}: “${MIMIC.phrases[i]}”`, done: i, total: MIMIC.phrases.length });
        // o gerador e sorteado: se a fala saiu cortada no final, tenta de novo (ate 3 vezes) e fica com a melhor
        let clip = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const c = await this._call('synthesize', { text: MIMIC.phrases[i] });
          this._chk();
          if (!clip || c.tail < clip.tail) clip = c;
          if (c.tail <= 0.35) break;
        }
        const pcm16 = trimClip(await resample(clip.pcm, clip.sr, UPLOAD_SR), UPLOAD_SR);
        this._ui('uploading', { msg: `Enviando fala ${i + 1}…` });
        this.send({ t: 'mimic', op: 'clip', i, sr: UPLOAD_SR, data: pcmToB64(pcm16) });
        await this._store(this.me, i, pcm16, UPLOAD_SR);
      }
      this.wipeWorkerVoice();                                // o "estado de voz" tambem e apagado: as falas ja estao prontas
      this._ui('ready', { seconds: (performance.now() - t0) / 1000 });
      return true;
    } catch (e) {
      if (this._cancelled) return false;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const nodev = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      const msg = denied ? 'O navegador não liberou o microfone. O recurso fica desligado.' : nodev ? 'Nenhum microfone encontrado. O recurso fica desligado.' : 'Não foi possível preparar a voz: ' + (e && e.message || e);
      this.revoke(this.owners.has(this.me));
      this._ui('error', { msg: msg + ' O jogo continua normalmente.' });
      return false;
    }
  }
  _chk() { if (this._cancelled) throw new Error('cancelado'); }
  // o jogador desistiu no meio (botao Cancelar): nada fica guardado
  cancel() {
    this._cancelled = true;
    this._begin?.(); this._stopRec?.();
    this.revoke(this.owners.has(this.me));
  }
  beginRecording() { this._begin?.(); }

  async _ensureWorker() {
    if (this.worker && this.ready) return;
    if (!this.worker) this.worker = new Worker(new URL('./pocket-worker.js', import.meta.url));
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.worker.onerror = (e) => this._failAll(new Error(e.message || 'erro no worker'));
    const assets = this.assets || await this._assets();
    this._ui('downloading', { loaded: 0, total: Object.values(MODEL_SIZES).reduce((a, b) => a + b, 0) });
    await this._call('init', { ...assets, language: 'portuguese', sizes: MODEL_SIZES });
    this.ready = true;
  }

  async _assets() {
    const base = (p) => new URL(p, document.baseURI).href;
    let ortBase = base('vendor/ort/');
    try { const r = await fetch(ortBase + 'ort.min.js', { method: 'HEAD' }); if (!r.ok) throw 0; } catch { ortBase = base('node_modules/onnxruntime-web/dist/'); }
    const cfg = (typeof window !== 'undefined' && window.APAGAO_CONFIG) || {};
    return { ortBase, spUrl: base('vendor/sentencepiece.js'), modelBase: cfg.mimicModelBase || HF_MODEL_BASE };
  }

  _call(type, data, transfer) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, data }, transfer || []);
    });
  }
  _onWorker(m) {
    if (m.type === 'progress') { this._ui('downloading', { loaded: m.loaded, total: m.total }); return; }
    if (m.type === 'status' || m.type === 'wiped') return;
    const p = this.pending.get(m.id);
    if (m.type === 'error') { if (p) { this.pending.delete(m.id); p.reject(new Error(m.error)); } else this._failAll(new Error(m.error)); return; }
    if (p && (m.type === 'ready' || m.type === 'encoded' || m.type === 'clip')) { this.pending.delete(m.id); p.resolve(m); }
  }
  _failAll(err) { for (const [, p] of this.pending) p.reject(err); this.pending.clear(); }

  // gravacao: AudioContext a 24 kHz + AudioWorklet (PCM cru, sem compressao com perdas)
  async _recordSample(maxSec = 14) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('microfone indisponível neste navegador');
    await new Promise((resolve) => { this._begin = resolve; });           // espera o jogador apertar "Gravar"
    this._begin = null;
    this._chk();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }, video: false });
    const ctx = new AudioContext({ sampleRate: 24000 });
    const code = 'class R extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("rec",R)';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'rec');
    const parts = []; node.port.onmessage = (e) => parts.push(e.data);
    src.connect(node);
    this._ui('recording', { text: SAMPLE_TEXT, live: true, maxSec });
    await new Promise((resolve) => { this._stopRec = resolve; setTimeout(resolve, maxSec * 1000); });
    this._stopRec = null;
    src.disconnect(); node.disconnect(); stream.getTracks().forEach(t => t.stop()); await ctx.close();
    const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    parts.length = 0;
    return out;
  }
  stopRecording() { this._stopRec?.(); }

  // ---- recepcao (de qualquer dono) ----
  async _store(owner, i, pcm, sr) {
    const buf = new OfflineAudioContext(1, Math.max(1, pcm.length), sr).createBuffer(1, Math.max(1, pcm.length), sr); buf.getChannelData(0).set(pcm);
    const dark = await darkenClip(buf);
    if (!this.clips.has(owner)) this.clips.set(owner, new Map());
    this.clips.get(owner).set(i, dark);
  }

  async receive(m) {
    if (m.op === 'on') this.owners.add(m.from);
    else if (m.op === 'gone') { this.owners.delete(m.from); this.clips.delete(m.from); this.onOwners?.(); }
    else if (m.op === 'clip') { try { await this._store(m.from, m.i | 0, b64ToPcm(m.data), m.sr | 0); } catch { /* clipe invalido: ignora */ } }
    else if (m.op === 'say') this.play(m.from, m.i | 0, { x: m.x, y: m.y, z: m.z });
    this.onOwners?.();
  }

  // toca o clipe (com o efeito ja aplicado) como som posicional vindo da criatura
  play(owner, i, pos) {
    const buf = this.clips.get(owner)?.get(i);
    const a = this.audio;
    if (!buf || !a.ready) return false;
    const out = a.spatial(pos, { ref: 3.2, rolloff: 1.0 });
    const s = a.ctx.createBufferSource(); s.buffer = buf;
    const g = a.gain(1.1); s.connect(g); g.connect(out.input);
    s.start(); this.stats.plays++;
    return true;
  }

  // ---- revogar / apagar ----
  wipeWorkerVoice() { try { this.worker?.postMessage({ type: 'wipe' }); } catch { /* ok */ } }
  wipe() { this.wipeWorkerVoice(); }
  // revogacao (ou fim): apaga do servidor e daqui; o worker e encerrado para liberar a memoria do modelo
  revoke(notify = true) {
    if (notify) this.send({ t: 'mimic', op: 'off' });
    this.owners.delete(this.me); this.clips.delete(this.me);
    this.dispose();
    this._ui('off', {});
  }
  dispose() {
    this.wipeWorkerVoice();
    try { this.worker?.terminate(); } catch { /* ok */ }
    this.worker = null; this.ready = false; this._failAll(new Error('encerrado'));
  }
  // fim da partida / sair da sala: descarta tudo
  endSession() {
    this.dispose(); this.owners.clear(); this.clips.clear();
    this._ui('off', {});
  }
}
