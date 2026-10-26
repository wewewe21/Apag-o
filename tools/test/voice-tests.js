// Testes de voz no navegador (console): const v = await import('/tools/test/voice-tests.js?v=1'); await v.radio(); await v.webrtc();
//  radio():  renderiza a cadeia de audio offline em varias distancias e mede o espectro (natural perto, radio longe, ruido so falando)
//  webrtc(): duas instancias de VoiceChat na mesma pagina trocando sinalizacao por um "servidor" falso, com microfone SINTETICO
//            (um oscilador): prova conexao, audio recebido e o bloqueio morto/vivo. NAO usa microfone real nem redes diferentes.
import { RadioVoice, radioMix, VOICE } from '/src/voice/radio.js';
import { VoiceChat } from '/src/voice/voicechat.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// sinal "de voz": harmonicos de 140 Hz ate 9 kHz com envoltoria silabica (4 Hz) + um pouco de ruido
function speechBuffer(ctx, dur) {
  const n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sampleRate, env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    let s = 0; for (let h = 1; h * 140 < 9000; h++) s += Math.sin(2 * Math.PI * 140 * h * t) / Math.pow(h, 0.45);
    d[i] = (s * 0.05 * env + (Math.random() * 2 - 1) * 0.05 * (0.4 + 0.6 * env)) * 0.9;      // harmonicos + fricativas
  }
  return b;
}

// energia por faixa (FFT simples por Goertzel em pontos) de um buffer mono
function bands(data, sr) {
  const N = 4096, start = Math.floor(data.length / 2 - N / 2);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = data[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const energy = (f0, f1) => {
    let e = 0;
    for (let f = f0; f < f1; f += sr / N * 6) {
      let re = 0, im = 0; const w = 2 * Math.PI * f / sr;
      for (let i = 0; i < N; i++) { re += win[i] * Math.cos(w * i); im -= win[i] * Math.sin(w * i); }      // todas as amostras (sem decimar: senao agudos "dobram" para dentro da banda)
      e += re * re + im * im;
    }
    return e;
  };
  const rms = Math.sqrt(data.reduce((a, v) => a + v * v, 0) / data.length);
  return { low: energy(60, 300), mid: energy(400, 3000), high: energy(4200, 9000), rms };
}

async function renderAt(dist, { noise = true, occluded = false, silent = false } = {}) {
  const sr = 24000, ctx = new OfflineAudioContext(2, sr * 1.2 | 0, sr);
  const src = ctx.createBufferSource(); src.buffer = silent ? ctx.createBuffer(1, sr, sr) : speechBuffer(ctx, 1.2); src.loop = true;
  const nb = ctx.createBuffer(1, sr, sr), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const cfg = { ...VOICE, noiseLevel: noise ? VOICE.noiseLevel : 0 };
  const rv = new RadioVoice(ctx, src, ctx.destination, nb, cfg);
  rv.speaking = !silent;
  ctx.listener.positionX?.setValueAtTime(0, 0);
  rv.set(dist, { x: 0, y: 0, z: -dist }, occluded, 1, 0, 0.001);
  src.start();
  const out = await ctx.startRendering();
  const l = out.getChannelData(0), r = out.getChannelData(1), m = new Float32Array(l.length);
  for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) / 2;
  return { ...bands(m, sr), mix: rv.mix };
}

export async function radio() {
  const res = {};
  const frac = (b) => { const t = b.low + b.mid + b.high + 1e-12; return { low: b.low / t, high: b.high / t }; };
  const near = await renderAt(2), mid = await renderAt(12), far = await renderAt(30);
  const fn = frac(near), fm = frac(mid), ff = frac(far);
  res.near = { mix: near.mix, low: +fn.low.toFixed(3), high: +fn.high.toFixed(4), rms: +near.rms.toFixed(4) };
  res.mid = { mix: +mid.mix.toFixed(2), low: +fm.low.toFixed(3), high: +fm.high.toFixed(4), rms: +mid.rms.toFixed(4) };
  res.far = { mix: far.mix, low: +ff.low.toFixed(3), high: +ff.high.toFixed(4), rms: +far.rms.toFixed(4) };
  const checks = {};
  const out = (f) => f.low + f.high;                       // energia FORA da banda do radio (380-3100 Hz)
  res.fora_da_banda = { perto: +out(fn).toFixed(3), meio: +out(fm).toFixed(3), longe: +out(ff).toFixed(3) };
  checks.perto_natural = near.mix === 0 && out(fn) > 0.3;                                       // voz cheia: graves e agudos presentes
  checks.longe_radio = far.mix === 1 && out(ff) < out(fn) * 0.55 && ff.high < fn.high * 0.5;      // banda limitada
  checks.longe_audivel = far.rms > 0.01 && far.rms / near.rms > 0.25;                             // a comunicacao continua
  const seq = []; for (const d of [5, 8, 11, 14, 17, 20]) { const b = await renderAt(d); seq.push(+out(frac(b)).toFixed(4)); }
  res.transicao_fora_da_banda = seq;
  checks.transicao_gradual = seq.every((v, i) => i === 0 || v <= seq[i - 1] + 0.03) && seq[0] > seq[5] * 1.5;
  let maxStep = 0; for (let d = 0; d < 25; d += 0.5) maxStep = Math.max(maxStep, Math.abs(radioMix(d + 0.5) - radioMix(d)));
  checks.mix_suave = maxStep < 0.12;
  const farSpeakNoise = await renderAt(30, { noise: true }), farSpeakNoNoise = await renderAt(30, { noise: false });
  res.ruido = { falandoLongeComRuido: +farSpeakNoise.high.toExponential(2), falandoLongeSemRuido: +farSpeakNoNoise.high.toExponential(2), rmsCom: +farSpeakNoise.rms.toFixed(4), rmsSem: +farSpeakNoNoise.rms.toFixed(4) };
  checks.ruido_durante_fala_longe = farSpeakNoise.high > farSpeakNoNoise.high * 1.5;
  checks.ruido_sutil = farSpeakNoise.rms < farSpeakNoNoise.rms * 1.25;
  const silent = await renderAt(30, { noise: true, silent: true });
  checks.sem_ruido_sem_fala = silent.rms < 1e-6;                                                   // silencio + sem fala: nada sai (nem chiado)
  const nearSpeakNoise = await renderAt(2, { noise: true }), nearSpeakNoNoise = await renderAt(2, { noise: false });
  checks.sem_ruido_perto = Math.abs(nearSpeakNoise.rms - nearSpeakNoNoise.rms) < nearSpeakNoNoise.rms * 0.02;
  const occl = await renderAt(2, { occluded: true });
  res.parede = { alta: +frac(occl).high.toExponential(2), semParede: +fn.high.toExponential(2) };
  checks.parede_abafa = frac(occl).high < fn.high * 0.3;
  res.checks = checks; res.ok = Object.values(checks).every(Boolean);
  return res;
}

// ---------- WebRTC entre duas instancias na mesma pagina, microfone sintetico ----------
function fakeMedia(ctx, freq = 220) {
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = 0.25; const dest = ctx.createMediaStreamDestination();
  osc.connect(g); g.connect(dest); osc.start();
  return { getUserMedia: async () => dest.stream, enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'fake', label: 'Microfone sintetico' }] };
}

export async function webrtc() {
  const ctx = new AudioContext(); await ctx.resume().catch(() => {});
  const audio = (c) => ({ ctx: c, master: c.destination, duckBeat() {} });
  const ctxA = ctx, ctxB = new AudioContext(); await ctxB.resume().catch(() => {});
  const sigLog = [];
  let A, B;
  const bus = (from) => (to, data) => { sigLog.push({ from, to, k: data.sdp ? data.sdp.type : 'ice' }); setTimeout(() => (to === 1 ? A : B).onSignal({ from, data }), 5); };
  const mk = (id, c, freq, blocked) => new VoiceChat({ audio: audio(c), game: {}, signal: (to, data) => { if (blocked?.()) return; bus(id)(to, data); }, ice: async () => [], media: fakeMedia(c, freq), RTC: RTCPeerConnection });
  A = mk(1, ctxA, 200); B = mk(2, ctxB, 330);
  const players = (sa, sb) => [{ id: 1, status: sa, online: true }, { id: 2, status: sb, online: true }];
  const res = { checks: {} };
  A.start(1, players('alive', 'alive')); B.start(2, players('alive', 'alive'));
  await A.enableMic(); await B.enableMic();
  res.mic = [A.micStatus, B.micStatus];
  const t0 = performance.now();
  while (performance.now() - t0 < 8000 && !(A.connected(2) && B.connected(1))) await wait(100);
  res.connectMs = Math.round(performance.now() - t0);
  res.checks.conectou = A.connected(2) && B.connected(1);
  // audio remoto chegando (RMS no analisador do par)
  let heard = 0; for (let i = 0; i < 30; i++) { const now = performance.now() / 1000; for (const v of [A, B]) for (const p of v.peers.values()) { p.radio?.measure(now); heard = Math.max(heard, p.radio?.level || 0); } await wait(50); }
  res.nivelRecebido = +heard.toFixed(4);
  res.checks.audio_chega = heard > 0.01;
  res.checks.falando_detectado = A.speaking(2) || B.speaking(1) || heard > 0.01;
  // mudo: o outro lado recebe silencio
  A.setMuted(true); await wait(600);
  let heardMute = 0; for (let i = 0; i < 20; i++) { const now = performance.now() / 1000; const p = B.peers.get(1); p.radio.measure(now); heardMute = Math.max(heardMute, p.radio.level); await wait(40); }
  res.nivelComMudo = +heardMute.toFixed(4);
  res.checks.mudo_silencia = heardMute < 0.004;
  A.setMuted(false);
  // A NAO ouve o proprio microfone (nenhum no liga a fonte local a saida)
  res.checks.sem_retorno_local = !A.micStream || ![...A.peers.values()].some(p => p.src && p.stream && p.stream.getAudioTracks().some(t => t.id === A.micTrack.id));
  // morte de 2: os vivos fecham a conexao (os dois lados), e sinalizacao vinda dele e ignorada
  const before = sigLog.length;
  A.setStatus(2, 'dead'); B.setStatus(2, 'dead');
  await wait(300);
  res.checks.vivo_fecha_com_morto = A.peers.size === 0 && !A.connected(2);
  res.checks.morto_fecha_com_vivo = B.peers.size === 0 && !B.connected(1);
  A.onSignal({ from: 2, data: { sdp: { type: 'offer', sdp: 'v=0' } } }); await wait(100);
  res.checks.ignora_sinal_do_morto = A.peers.size === 0;
  // reconectar nao restaura: o estado ("dead") continua e a regra impede reabrir
  B.setOnline(1, false); B.setOnline(1, true); A.setOnline(2, false); A.setOnline(2, true); await wait(200);
  res.checks.reconexao_nao_reabre = A.peers.size === 0;
  // dois espiritos podem se falar
  A.setStatus(1, 'dead'); B.setStatus(1, 'alive');    // A tambem morre (visao de A: eu=1)
  A.statusOf.set(1, 'dead'); B.statusOf.set(1, 'dead');
  A.reconcile(); B.reconcile(); await wait(300);
  const t1 = performance.now(); while (performance.now() - t1 < 8000 && !(A.connected(2) && B.connected(1))) await wait(100);
  res.checks.espiritos_se_falam = A.connected(2) && B.connected(1);
  A.stop(); B.stop();
  res.checks.libera_microfone = A.micStream === null && B.micStream === null && A.peers.size === 0;
  res.ok = Object.values(res.checks).every(Boolean);
  return res;
}

// falhas do microfone nao impedem a partida
export async function micErrors() {
  const ctx = new AudioContext();
  const mk = (err) => new VoiceChat({ audio: { ctx, master: ctx.destination, duckBeat() {} }, game: {}, signal() {}, ice: async () => [], media: { getUserMedia: async () => { const e = new Error('x'); e.name = err; throw e; }, enumerateDevices: async () => [] } });
  const out = {};
  for (const [name, err] of [['negado', 'NotAllowedError'], ['sem_dispositivo', 'NotFoundError'], ['em_uso', 'NotReadableError'], ['outro', 'TypeError']]) {
    const v = mk(err); v.start(1, [{ id: 1, status: 'alive', online: true }]); const ok = await v.enableMic(); out[name] = { ok, status: v.micStatus, running: v.running };
  }
  const vn = new VoiceChat({ audio: { ctx, master: ctx.destination, duckBeat() {} }, game: {}, signal() {}, ice: async () => [], media: {} });
  vn.start(1, []); out.sem_api = { ok: await vn.enableMic(), status: vn.micStatus };
  out.ok = out.negado.status === 'denied' && out.sem_dispositivo.status === 'nodevice' && out.em_uso.status === 'busy' && out.outro.status === 'error' && out.sem_api.status === 'unsupported' && Object.values(out).slice(0, 4).every(o => o.running);
  return out;
}
