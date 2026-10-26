// Cadeia de audio da voz de UM jogador remoto, calculada para CADA ouvinte:
//  - perto: voz natural, espacial (HRTF), sem filtro; abafada por paredes;
//  - longe: efeito de radio (banda limitada, compressao leve, distorcao suave e ruido sutil SO durante a fala);
//  - entre os dois: transicao gradual (mix continuo pela distancia).
// So depende de um AudioContext (funciona com OfflineAudioContext nos testes).
import { clamp } from '../core/rng.js';

export const VOICE = {
  near: 7,             // m: ate aqui a voz e 100% natural
  far: 17,             // m: a partir daqui e 100% radio
  radioBand: [380, 3100],   // Hz do "radio"
  radioGain: 0.85,
  noiseLevel: 0.028,   // nivel do chiado durante a fala (sutil)
  noiseHold: 0.25,     // s que o chiado permanece depois da fala
  speakThreshold: 0.012,    // RMS a partir do qual conta como fala
  maxDistance: 60,
  occludedCut: 900,    // Hz: paredes entre voces abafam a voz natural
};

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// fracao de "radio" (0 = natural, 1 = radio) para uma distancia
export function radioMix(dist, cfg = VOICE) { return smooth(cfg.near, cfg.far, dist); }

function shaperCurve(amount = 1.6) {
  const n = 512, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return c;
}

export class RadioVoice {
  // ctx: AudioContext; source: no com a voz (MediaStreamAudioSourceNode); out: no de destino (barramento de voz)
  constructor(ctx, source, out, noiseBuffer, cfg = VOICE) {
    this.ctx = ctx; this.cfg = cfg;
    const c = ctx;
    // ----- caminho natural (espacial) -----
    this.dry = c.createGain(); this.dry.gain.value = 1;
    this.occl = c.createBiquadFilter(); this.occl.type = 'lowpass'; this.occl.frequency.value = 20000; this.occl.Q.value = 0.7;
    this.panner = c.createPanner(); this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1.6; this.panner.maxDistance = cfg.maxDistance; this.panner.rolloffFactor = 1.15;
    source.connect(this.dry); this.dry.connect(this.occl); this.occl.connect(this.panner); this.panner.connect(out);
    // ----- caminho de radio (sem posicao: sai "dentro da cabeca", como um radio) -----
    this.radio = c.createGain(); this.radio.gain.value = 0;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = cfg.radioBand[0]; hp.Q.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cfg.radioBand[1]; lp.Q.value = 0.8;
    const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = cfg.radioBand[1] * 1.15; lp2.Q.value = 0.7;   // 24 dB/oct no total
    const pre = c.createGain(); pre.gain.value = 1.6;
    const shaper = c.createWaveShaper(); shaper.curve = shaperCurve(); shaper.oversample = '2x';
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -26; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.18;
    const post = c.createGain(); post.gain.value = cfg.radioGain * 0.6;
    source.connect(hp); hp.connect(pre); pre.connect(shaper); shaper.connect(lp); lp.connect(lp2); lp2.connect(comp); comp.connect(post); post.connect(this.radio); this.radio.connect(out);      // distorcao ANTES do passa-baixa: os harmonicos gerados tambem ficam na banda do radio
    // ----- chiado: so enquanto a pessoa fala -----
    this.noiseGain = c.createGain(); this.noiseGain.gain.value = 0;
    if (noiseBuffer) {
      this.noise = c.createBufferSource(); this.noise.buffer = noiseBuffer; this.noise.loop = true;
      const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 2100; nb.Q.value = 0.55;
      this.noise.connect(nb); nb.connect(this.noiseGain); this.noiseGain.connect(out);
      this.noise.start();
    }
    // ----- medidor de fala -----
    this.an = c.createAnalyser(); this.an.fftSize = 512; source.connect(this.an);
    this._buf = new Float32Array(this.an.fftSize);
    this.level = 0; this.speaking = false; this._lastSpeech = -9; this.mix = 0;
  }

  // nivel atual da fala (RMS) — chamar ~20-30x por segundo
  measure(now) {
    this.an.getFloatTimeDomainData(this._buf);
    let s = 0; for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
    this.level = Math.sqrt(s / this._buf.length);
    if (this.level > this.cfg.speakThreshold) this._lastSpeech = now;
    this.speaking = now - this._lastSpeech < this.cfg.noiseHold;
    return this.level;
  }

  // dist: metros ate o falante; pos: posicao do falante {x,y,z}; occluded: ha parede entre voces
  set(dist, pos, occluded, volume, now, smoothing = 0.06) {
    const c = this.cfg, t = this.ctx.currentTime;
    const m = radioMix(dist, c);
    this.mix = m;
    // caminho natural some conforme entra o radio; parede abafa
    const dryK = Math.cos(m * Math.PI / 2), radK = Math.sin(m * Math.PI / 2);       // potencia constante na troca
    this.dry.gain.setTargetAtTime(dryK * volume, t, smoothing);
    this.occl.frequency.setTargetAtTime(occluded ? c.occludedCut : 20000, t, 0.12);
    const p = this.panner;
    if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.y, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05); } else p.setPosition(pos.x, pos.y, pos.z);
    // radio: um pouco mais fraco com a distancia (ate 40%), nunca some (a comunicacao continua)
    const far = 1 - clamp((dist - c.far) / c.maxDistance, 0, 0.4);
    this.radio.gain.setTargetAtTime(radK * far * volume, t, smoothing);
    // chiado: proporcional ao radio e so quando fala (a voz nao muda de nivel com ele)
    this.noiseGain.gain.setTargetAtTime(this.speaking ? c.noiseLevel * radK * volume : 0, t, this.speaking ? 0.03 : 0.12);
  }

  dispose() {
    try { this.noise?.stop(); } catch { /* ok */ }
    for (const n of [this.dry, this.occl, this.panner, this.radio, this.noiseGain, this.an]) { try { n.disconnect(); } catch { /* ok */ } }
  }
}
