// Testes do "eco de voz" no navegador (console do painel):
//   const t = await import('/tools/test/mimic-tests.js?v=1');
//   await t.effects();   // efeito sombrio: sem NaN, pico controlado, agudos abafados, formantes/envoltoria preservados (rapido, sem modelo)
//   await t.pipeline();  // amostra -> modelo local -> 5 frases -> clipes enviados/guardados; amostra descartada (baixa ~146 MB na 1a vez)
//   await t.speaker();   // a voz gerada segue a amostra (duas amostras com tons diferentes -> saidas com tons diferentes)
// LIMITES: a amostra e SINTETICA (nao ha microfone no painel); a inteligibilidade e medida por proxies (envoltoria e espectro
// nas faixas da fala), nao por reconhecimento de fala nem por ouvintes humanos.
import { MimicClient, darkenClip, checkSample, trimClip, resample, pcmToB64, b64ToPcm, UPLOAD_SR, SAMPLE_TEXT, DARK } from '/src/voice/mimic/mimic.js';
import { MIMIC } from '/src/shared/coop.js';

const log = [];
const ok = (cond, msg, extra = '') => { log.push({ ok: !!cond, msg, extra }); console.log((cond ? 'ok   ' : 'FALHA'), msg, extra); return !!cond; };

// ---------- sinais de teste ----------
// "voz" sintetica: trem de pulsos com jitter + formantes de vogais que mudam no tempo + envoltoria silabica + ruido de sopro
export async function syntheticVoice(f0 = 120, sec = 9, sr = 24000) {
  const off = new OfflineAudioContext(1, Math.floor(sr * sec), sr);
  const osc = off.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f0, 0);
  const vib = off.createOscillator(); vib.frequency.value = 5; const vg = off.createGain(); vg.gain.value = f0 * 0.02; vib.connect(vg); vg.connect(osc.frequency);
  // entonacao: f0 sobe e desce
  for (let t = 0; t < sec; t += 0.5) osc.frequency.linearRampToValueAtTime(f0 * (1 + 0.12 * Math.sin(t * 1.7)), t);
  const vowels = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [660, 1720, 2410]];
  const sum = off.createGain(); sum.gain.value = 1;
  const banks = [0, 1, 2].map(k => {
    const f = off.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [8, 10, 12][k]; f.frequency.value = vowels[0][k];
    for (let t = 0, i = 0; t < sec; t += 0.22, i++) f.frequency.linearRampToValueAtTime(vowels[i % vowels.length][k], t);
    const g = off.createGain(); g.gain.value = [1, 0.6, 0.3][k]; osc.connect(f); f.connect(g); g.connect(sum); return f;
  });
  const env = off.createGain(); env.gain.value = 0;
  for (let t = 0, i = 0; t < sec; t += 0.22, i++) { const talk = (i % 9) < 7; env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(talk ? 0.9 : 0.02, t + 0.05); env.gain.linearRampToValueAtTime(talk ? 0.35 : 0.02, t + 0.2); }
  sum.connect(env);
  // sopro (fricativas leves)
  const nb = off.createBuffer(1, off.length, sr), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = off.createBufferSource(); ns.buffer = nb; const nf = off.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3500; const ng = off.createGain(); ng.gain.value = 0.02;
  ns.connect(nf); nf.connect(ng); ng.connect(off.destination);
  const master = off.createGain(); master.gain.value = 0.9; env.connect(master); master.connect(off.destination);
  osc.start(); vib.start(); ns.start();
  const buf = await off.startRendering(); const d = buf.getChannelData(0).slice();
  let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); const k = 0.5 / (pk || 1); for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}

// ---------- medidas ----------
function envelope(d, sr, frameMs = 10) {
  const fr = Math.round(sr * frameMs / 1000), e = [];
  for (let s = 0; s + fr <= d.length; s += fr) { let a = 0; for (let i = 0; i < fr; i++) a += d[s + i] * d[s + i]; e.push(Math.sqrt(a / fr)); }
  return e;
}
const corr = (a, b) => {
  const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb + 1e-12);
};
// espectro medio (LTAS) por Goertzel em pontos; devolve energia em dB por faixa
function ltas(d, sr, freqs) {
  const N = 2048, hop = 1024, win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const acc = new Float64Array(freqs.length); let frames = 0;
  for (let s = 0; s + N <= d.length; s += hop * 3) {
    let en = 0; for (let i = 0; i < N; i++) en += d[s + i] * d[s + i];
    if (Math.sqrt(en / N) < 0.01) continue;
    frames++;
    freqs.forEach((f, k) => { let re = 0, im = 0; const w = 2 * Math.PI * f / sr; for (let i = 0; i < N; i++) { const x = d[s + i] * win[i]; re += x * Math.cos(w * i); im -= x * Math.sin(w * i); } acc[k] += re * re + im * im; });
  }
  return Array.from(acc, v => 10 * Math.log10(v / Math.max(1, frames) + 1e-12));
}
export function estimateF0(d, sr) {
  const fr = Math.round(sr * 0.04), lo = Math.round(sr / 400), hi = Math.round(sr / 70), f0s = [];
  for (let s = 0; s + fr + hi <= d.length; s += Math.round(fr / 2)) {
    let e0 = 0; for (let i = 0; i < fr; i++) e0 += d[s + i] * d[s + i];
    if (Math.sqrt(e0 / fr) < 0.02) continue;
    let best = 0, bl = 0;
    for (let l = lo; l <= hi; l++) { let c = 0, e1 = 0; for (let i = 0; i < fr; i++) { c += d[s + i] * d[s + i + l]; e1 += d[s + i + l] * d[s + i + l]; } const r = c / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; bl = l; } }
    if (best > 0.55) f0s.push(sr / bl);
  }
  f0s.sort((a, b) => a - b);
  return f0s.length >= 5 ? f0s[f0s.length >> 1] : NaN;
}
const toBuf = (d, sr) => { const b = new OfflineAudioContext(1, d.length, sr).createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };

// ---------- 1. efeito sombrio (sem modelo) ----------
export async function effects() {
  log.length = 0;
  const sr = 16000, src = (await resample(await syntheticVoice(130, 2.4, 24000), 24000, sr));
  const buf = toBuf(src, sr);
  const dark = await darkenClip(buf);
  const d = dark.getChannelData(0);
  let bad = 0, pk = 0; for (const v of d) { if (!Number.isFinite(v)) bad++; pk = Math.max(pk, Math.abs(v)); }
  ok(bad === 0, 'efeito: sem NaN/infinito');
  ok(pk > 0.5 && pk <= 0.86, 'efeito: pico normalizado (nao estoura nem some)', pk.toFixed(2));
  const dur0 = src.length / sr, dur1 = d.length / dark.sampleRate;
  ok(dur1 > dur0 * 1.05 && dur1 < dur0 / 0.9 + 1.2, 'efeito: mais lento (~0,9x) e com cauda curta de eco', `${dur0.toFixed(2)}s -> ${dur1.toFixed(2)}s`);
  // formantes/tom: pitch cai ~10 % (0,9x) — voz mais grave, mas ainda voz
  const f0a = estimateF0(src, sr), f0b = estimateF0(d, dark.sampleRate);
  ok(f0b / f0a > 0.8 && f0b / f0a < 0.97, 'efeito: tom ~10 % mais grave (reconhecivel, nao irreconhecivel)', `${f0a.toFixed(0)} -> ${f0b.toFixed(0)} Hz`);
  // espectro: abafado nos agudos, faixa da fala (300-3400) preservada
  const fs = [500, 1000, 2000, 3000, 6000, 7500];
  const A = ltas(src, sr, fs), B = ltas(d, dark.sampleRate, fs);
  const rel = (X) => X.map(v => v - X[1]);          // relativo a 1 kHz
  const ra = rel(A), rb = rel(B);
  ok(rb[5] < ra[5] - 3, 'efeito: agudos (7,5 kHz) abafados', `${ra[5].toFixed(1)} -> ${rb[5].toFixed(1)} dB`);
  ok(Math.abs(rb[2] - ra[2]) < 8 && Math.abs(rb[3] - ra[3]) < 10, 'efeito: faixa da fala (2-3 kHz, formantes) preservada', `2k ${(rb[2] - ra[2]).toFixed(1)} 3k ${(rb[3] - ra[3]).toFixed(1)} dB`);
  // envoltoria silabica: correlacao apos compensar a lentidao
  const ea = envelope(src, sr), eb = envelope(d, dark.sampleRate);
  const ea2 = Array.from({ length: Math.floor(ea.length / 0.9) }, (_, i) => ea[Math.min(ea.length - 1, Math.round(i * 0.9))]);
  const c = corr(ea2, eb);
  ok(c > 0.75, 'efeito: silabas (envoltoria) preservadas -> inteligibilidade preservada (proxy)', 'corr=' + c.toFixed(2));
  return summary();
}

// ---------- 2. funil completo com o modelo local ----------
export async function pipeline({ f0 = 118, keep = true } = {}) {
  log.length = 0;
  const sent = [], steps = [];
  const audio = window.__game?.audio || { ready: false };
  const client = new MimicClient({ audio, send: (o) => sent.push(o), ui: { set: (s, i) => steps.push(s + (i && i.done != null ? `:${i.done}` : '')) }, getSample: async () => sample });
  client.me = 'test';
  const sample = await syntheticVoice(f0, 9.5, 24000);
  const n0 = sample.length;
  ok(checkSample(sample, 24000).ok, 'amostra sintetica passa na validacao', JSON.stringify(checkSample(sample, 24000)));
  // amostras ruins sao recusadas com motivo claro
  ok(!checkSample(new Float32Array(24000 * 3), 24000).ok, 'validacao recusa amostra curta/silenciosa', checkSample(new Float32Array(24000 * 3), 24000).why);
  ok(!checkSample(new Float32Array(24000 * 8).fill(0.001), 24000).ok, 'validacao recusa silencio', checkSample(new Float32Array(24000 * 8).fill(0.001), 24000).why);
  const loud = sample.map(v => Math.max(-1, Math.min(1, v * 40))); ok(!checkSample(loud, 24000).ok, 'validacao recusa gravacao estourada', checkSample(loud, 24000).why);
  const t0 = performance.now();
  const done = await client.run();
  const secs = (performance.now() - t0) / 1000;
  ok(done === true, 'fluxo completo terminou', `${secs.toFixed(0)} s`);
  ok(steps.includes('downloading') && steps.includes('recording') && steps.some(s => s.startsWith('processing')) && steps.at(-1) === 'ready', 'etapas da interface: baixar -> gravar -> processar -> pronto', steps.join(' > '));
  ok(sample.length === 0 || sample.buffer.byteLength === 0, 'amostra bruta foi transferida ao worker (nao fica copia no cliente)', `len ${n0} -> ${sample.length}`);
  const on = sent.filter(m => m.op === 'on'), clips = sent.filter(m => m.op === 'clip');
  ok(on.length === 1, 'enviou "on" uma vez');
  ok(sent[0].op === 'on', 'consentimento/opt-in vem antes de qualquer clipe');
  ok(clips.length === MIMIC.phrases.length && new Set(clips.map(c => c.i)).size === MIMIC.phrases.length, `enviou ${MIMIC.phrases.length} clipes, um por frase`);
  ok(clips.every(c => c.sr === UPLOAD_SR && c.data.length <= MIMIC.maxClipChars), 'clipes dentro dos limites do servidor', clips.map(c => c.data.length).join(','));
  const total = clips.reduce((a, c) => a + c.data.length, 0);
  ok(total <= MIMIC.maxTotalChars, 'total dentro do limite do servidor', String(total));
  const durs = clips.map(c => b64ToPcm(c.data).length / c.sr);
  ok(durs.every(x => x > 0.5 && x <= 3.5), 'duracoes plausiveis (0,5-3,5 s)', durs.map(x => x.toFixed(2)).join(' '));
  const pcms = clips.map(c => b64ToPcm(c.data));
  ok(pcms.every(p => { let pk = 0, e = 0; for (const v of p) { pk = Math.max(pk, Math.abs(v)); e += v * v; } return pk > 0.05 && Math.sqrt(e / p.length) > 0.01; }), 'clipes tem fala audivel (nao silencio)');
  ok(client.clips.get('test')?.size === MIMIC.phrases.length, 'clipes com efeito guardados para tocar depois');
  ok(client.worker && client.ready, 'worker segue vivo ate o fim da partida/revogacao');
  window.__mimicTest = { client, pcms, sent };
  return summary();
}

// ---------- 3. a voz gerada segue a amostra ----------
export async function speaker() {
  log.length = 0;
  const mk = async (f0) => {
    const steps = [];
    const c = new MimicClient({ audio: { ready: false }, send: () => {}, ui: { set: (s) => steps.push(s) }, getSample: async () => syntheticVoice(f0, 9.5, 24000), worker: window.__mimicTest?.client.worker });
    return c;
  };
  const base = window.__mimicTest?.client;
  if (!base?.worker) { ok(false, 'rode pipeline() antes (reusa o modelo carregado)'); return summary(); }
  const w = base;
  const gen = async (f0) => {
    const s = await syntheticVoice(f0, 9.5, 24000);
    await w._call('encode', { audio: s }, [s.buffer]);
    const out = []; for (const t of ['Vem aqui.', 'Estou perto do quadro.']) { const c = await w._call('synthesize', { text: t }); out.push(c.pcm); }
    const all = new Float32Array(out.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of out) { all.set(p, o); o += p.length; }
    return { pcm: all, sr: 24000 };
  };
  const lowRef = 100, highRef = 220;
  const A = await gen(lowRef), B = await gen(highRef);
  const fa = estimateF0(A.pcm, A.sr), fb = estimateF0(B.pcm, B.sr);
  ok(Number.isFinite(fa) && Number.isFinite(fb), 'tom medido nas duas saidas', `${fa.toFixed(0)} Hz e ${fb.toFixed(0)} Hz`);
  ok(fb > fa * 1.15, 'a voz gerada acompanha o tom da amostra (amostra grave -> saida mais grave que amostra aguda)', `ref ${lowRef}->${fa.toFixed(0)} Hz | ref ${highRef}->${fb.toFixed(0)} Hz`);
  w.wipeWorkerVoice();
  const r = await w._call('synthesize', { text: 'Vem aqui.' }).then(() => 'gerou', (e) => e.message);
  ok(/Nenhuma voz/.test(r), 'apos apagar a voz o modelo nao gera mais nada', r);
  return summary();
}

// ---------- 3b. inteligibilidade medida com reconhecimento de fala (Whisper, so para TESTE; nao vai no jogo) ----------
// Compara a transcricao da fala gerada "crua" com a que passa pelo caminho real do jogo (16 kHz -> corte -> efeito sombrio).
// Usa o worker de teste (window.__dcall) ja com uma voz codificada. O Whisper vem do CDN so na pagina de teste.
const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
export const cer = (ref, hyp) => { const a = strip(ref), b = strip(hyp); return lev(a, b) / Math.max(1, a.length); };
export async function intelligibility({ reps = 2, call = window.__dcall, asr = window.__asr } = {}) {
  log.length = 0;
  if (!asr || !call) { ok(false, 'precisa de window.__asr (Whisper) e window.__dcall (worker com voz codificada)'); return summary(); }
  const rows = [];
  for (const phrase of MIMIC.phrases) for (let k = 0; k < reps; k++) {
    const r = await call('synthesize', { text: phrase });
    const raw16 = await resample(r.pcm, r.sr, 16000);
    const up = trimClip(await resample(r.pcm, r.sr, UPLOAD_SR), UPLOAD_SR);              // o que vai ao servidor
    const dark = await darkenClip(toBuf(up, UPLOAD_SR));                                  // o que os jogadores ouvem
    const dark16 = await resample(dark.getChannelData(0).slice(), dark.sampleRate, 16000);
    const t = async (x) => (await asr(x, { language: 'portuguese', task: 'transcribe' })).text;
    const [a, b] = [await t(raw16), await t(dark16)];
    rows.push({ phrase, raw: a, dark: b, cerRaw: cer(phrase, a), cerDark: cer(phrase, b) });
  }
  const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const okRaw = rows.filter(r => r.cerRaw <= 0.35).length, okDark = rows.filter(r => r.cerDark <= 0.35).length;
  ok(true, `CER medio (0 = perfeito): fala gerada ${mean(r => r.cerRaw).toFixed(2)} | apos efeito sombrio ${mean(r => r.cerDark).toFixed(2)}`);
  ok(okRaw >= rows.length * 0.6, `fala gerada reconhecida (CER<=0,35) em ${okRaw}/${rows.length}`);
  ok(okDark >= okRaw - 2 && mean(r => r.cerDark) <= mean(r => r.cerRaw) + 0.2, `o efeito sombrio quase nao piora o reconhecimento (${okDark}/${rows.length} vs ${okRaw}/${rows.length})`);
  window.__intel = rows;
  return { ...summary(), rows };
}

// Varredura de configuracoes do efeito sobre os MESMOS clipes crus (para escolher o efeito sem depender do sorteio do gerador).
//   window.__raw = await t.genRaw({reps:3});  const res = await t.sweep(window.__raw, { atual: DARK, leve: {...DARK, tremDepth: 0.06} });
export async function genRaw({ reps = 3, phrases = MIMIC.phrases, call = window.__dcall } = {}) {
  const out = [];
  for (const phrase of phrases) for (let k = 0; k < reps; k++) {
    const r = await call('synthesize', { text: phrase });
    out.push({ phrase, up: trimClip(await resample(r.pcm, r.sr, UPLOAD_SR), UPLOAD_SR) });
  }
  return out;
}
export async function sweep(raw, configs, { asr = window.__asr, onlyRaw = true } = {}) {
  const t = async (x) => (await asr(x, { language: 'portuguese', task: 'transcribe' })).text;
  const res = {};
  const run = async (name, render) => {
    const rows = [];
    for (const c of raw) { const x = await render(c.up); const h = await t(x); rows.push({ phrase: c.phrase, hyp: h, cer: cer(c.phrase, h) }); }
    res[name] = { cer: +(rows.reduce((a, r) => a + r.cer, 0) / rows.length).toFixed(3), ok: rows.filter(r => r.cer <= 0.35).length + '/' + rows.length, rows };
  };
  await run('cru', async (up) => resample(up, UPLOAD_SR, 16000));
  for (const [name, cfg] of Object.entries(configs)) await run(name, async (up) => { const d = await darkenClip(toBuf(up, UPLOAD_SR), cfg); return resample(d.getChannelData(0).slice(), d.sampleRate, 16000); });
  return res;
}

// ---------- 4. toque no jogo ----------
export async function play() {
  log.length = 0;
  const t = window.__mimicTest, g = window.__game;
  if (!t || !g?.audio?.ready) { ok(false, 'precisa de pipeline() e do jogo iniciado (audio pronto)'); return summary(); }
  const c = t.client; c.audio = g.audio;
  const p = g.player.pos ?? g.camera.position;
  const r1 = c.play('test', 1, { x: p.x + 4, y: 1.6, z: p.z });
  ok(r1 === true, 'toca o clipe no ponto da criatura (posicional)');
  ok(c.play('naoexiste', 1, { x: 0, y: 1, z: 0 }) === false, 'sem clipe/dono desconhecido: silencio, sem erro');
  c.endSession();
  ok(c.clips.size === 0 && c.owners.size === 0 && !c.worker, 'encerrar sessao apaga clipes, donos e worker');
  return summary();
}

function summary() { const bad = log.filter(l => !l.ok); console.log(bad.length ? `${bad.length} FALHA(S)` : 'TUDO OK', `(${log.length} checagens)`); return { ok: bad.length === 0, total: log.length, bad, log: log.map(l => (l.ok ? 'ok ' : 'FALHA ') + l.msg + (l.extra ? ' [' + l.extra + ']' : '')) }; }
