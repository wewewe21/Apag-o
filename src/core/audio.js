// Masters ElevenLabs com trilha adaptativa, HRTF e oclusão por paredes.
// A síntese original mantém as pistas disponíveis durante o carregamento.
import { clamp, range, pick, damp, lerp } from './rng.js';
import { HEARTBEAT as HB } from '../config.js';
import { AudioLibrary } from './audio-library.js';
import { footstepMaterial, footstepSurfaceAt, FOOTSTEP_MIX } from './footsteps.js';

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.fear = 0;
  }

  init(volume = 0.8) {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb gerado: ruido com decaimento exponencial, escuro
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.2);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb); this.reverb.connect(this.master);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.dry); this.sfx.connect(this.revSend);
    // buffers de ruido
    this.white = this._noiseBuf('white', 2);
    this.pink = this._noiseBuf('pink', 4);
    this.brown = this._noiseBuf('brown', 4);
    this._ambience();
    this._breathLoop();
    this._heart();
    this._hum();
    this.eventT = 6;
    this.dripT = 2;
    this.ready = true;
    this.library = new AudioLibrary(this);
  }

  setVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  _sample(id, opts) { return this.ready && this.library?.play(id, opts); }
  reset() { this.library?.reset(); this.stopSiren(); this.sizzle(false); }

  _impulse(dur, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp = lp * 0.82 + (Math.random() * 2 - 1) * 0.18;   // passa-baixa simples: sala escura
        d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  _noiseBuf(kind, dur) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  // ---------- blocos ----------
  now() { return this.ctx.currentTime; }
  noise(kind = 'white', loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this[kind]; s.loop = loop;
    if (!loop) s.loopStart = 0;
    return s;
  }
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  filt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }
  dist(amount = 20) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + amount) * x / (1 + amount * Math.abs(x)); }
    ws.curve = c; return ws;
  }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  // saida posicional com oclusao
  spatial(pos, opts = {}) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = opts.ref ?? 1.5; p.maxDistance = 60; p.rolloffFactor = opts.rolloff ?? 1.1;
    const set = (a, v) => { if (a) a.value = v; };
    if (p.positionX) { set(p.positionX, pos.x); set(p.positionY, pos.y); set(p.positionZ, pos.z); } else p.setPosition(pos.x, pos.y, pos.z);
    const input = this.gain(1);
    let node = input;
    if (!opts.noDuck) this.duckBeat();
    const cam = this.game.camera.position;
    const occluded = !this.game.grid.segmentClear(cam.x, cam.z, pos.x, pos.z, true) || Math.abs(cam.y - pos.y) > 3;
    if (occluded) {
      const lp = this.filt('lowpass', opts.occl ?? 650, 0.7);
      const og = this.gain(0.55);
      node = this.chain(input, lp, og);
    }
    node.connect(p);
    p.connect(this.dry); p.connect(this.revSend);
    return { input, panner: p, occluded };
  }

  listener() {
    if (!this.ctx) return;
    const cam = this.game.camera;
    const l = this.ctx.listener;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(cam.position.x, t, 0.02); l.positionY.setTargetAtTime(cam.position.y, t, 0.02); l.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      const m = cam.matrixWorld?.elements;
      l.upX.value = m?.[4] ?? 0; l.upY.value = m?.[5] ?? 1; l.upZ.value = m?.[6] ?? 0;
    } else { l.setPosition(cam.position.x, cam.position.y, cam.position.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // ---------- camadas continuas ----------
  _ambience() {
    const ctx = this.ctx;
    this.amb = this.gain(0.0);
    this.amb.connect(this.dry); this.amb.connect(this.revSend);
    const rumble = this.noise('brown', true);
    this.ambLP = this.filt('lowpass', 140, 0.6);
    this.chain(rumble, this.ambLP, this.amb);
    rumble.start();
    // dois tons graves desafinados = pressao
    for (const [f, v] of [[41, 0.05], [55.4, 0.035], [82.7, 0.012]]) {
      const o = this.osc('sine', f); const g = this.gain(v);
      const lfo = this.osc('sine', 0.05 + Math.random() * 0.08); const lg = this.gain(v * 0.8);
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(this.amb); o.start(); lfo.start();
    }
    // chiado de sala
    const hiss = this.noise('pink', true); const hg = this.gain(0.012);
    this.chain(hiss, this.filt('highpass', 3000, 0.5), hg, this.amb); hiss.start();
    this.amb.gain.setTargetAtTime(0.55, ctx.currentTime, 2);
    // chuva (so no final/patio)
    const rain = this.noise('pink', true);
    this.rain = this.gain(0);
    this.chain(rain, this.filt('bandpass', 2500, 0.3), this.rain, this.dry); rain.start();
  }

  _breathLoop() {
    // respiracao do jogador: ruido com formante modulado por um ciclo
    const src = this.noise('pink', true);
    this.breathF = this.filt('bandpass', 1100, 1.4);
    this.breathG = this.gain(0);
    this.chain(src, this.breathF, this.breathG, this.dry);
    src.start();
    this.breathPhase = 0; this.breathRate = 0.25; this.holding = false;
  }

  _heart() {
    // heartG: barramento dos "baques" gerais (fusivel, alavanca, susto). O coracao do jogador tem barramento proprio:
    // passa-faixa (sem estrondo nos alto-falantes) + ducking para nao encobrir passos, gritos e pistas.
    this.heartT = 0; this.heartG = this.gain(0.9); this.heartG.connect(this.dry);
    this.beatBus = this.gain(1);
    this.beatDuck = this.gain(1);
    this.chain(this.beatBus, this.filt('highpass', 32, 0.7), this.filt('lowpass', 230, 0.7), this.beatDuck, this.dry);
    this.heartK = 0; this.heartStats = { k: 0, bpm: 0, vol: 0, beats: 0 };
  }

  // abaixa o coracao por um instante (pista sonora importante tocando)
  duckBeat(dur = 0.28) {
    if (!this.beatDuck) return;
    const t = this.now(), g = this.beatDuck.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(HB.duck, t, 0.02); g.setTargetAtTime(1, t + dur, 0.3);
  }

  // uma batida "lub-dub"
  _beat(t, bpm, v) {
    if (this._sample('heartbeat', { volume: v * 2.3, rate: clamp(bpm / 90, 0.8, 1.2), reverb: 0 })) return;
    const gap = Math.min(0.2, 60 / bpm * 0.3);
    for (const [dt_, f, k] of [[0, 54, 1], [gap, 46, 0.72]]) {
      const o = this.osc('sine', f * 1.7), g = this.gain(0);
      o.frequency.setValueAtTime(f * 1.7, t + dt_); o.frequency.exponentialRampToValueAtTime(f, t + dt_ + 0.07);
      this.chain(o, g, this.beatBus);
      this.env(g, t + dt_, 0.009, v * k, 0.2);
      o.start(t + dt_); o.stop(t + dt_ + 0.3);
      const n = this.noise('brown'), ng = this.gain(0);      // "tum" seco do musculo
      this.chain(n, this.filt('lowpass', 180, 0.8), ng, this.beatBus);
      this.env(ng, t + dt_, 0.004, v * k * 0.9, 0.06);
      n.start(t + dt_, Math.random()); n.stop(t + dt_ + 0.12);
    }
  }

  _hum() {
    // zumbido das fluorescentes: duas vozes presas as lampadas acesas mais proximas
    this.hums = [];
    for (let i = 0; i < 2; i++) {
      const ctx = this.ctx;
      const o = this.osc('sawtooth', 120); const o2 = this.osc('square', 60);
      const bp = this.filt('bandpass', 240, 3);
      const g = this.gain(0);
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 1.2; p.rolloffFactor = 1.6; p.distanceModel = 'inverse';
      o.connect(bp); const g2 = this.gain(0.3); o2.connect(g2); g2.connect(bp);
      this.chain(bp, g, p); p.connect(this.dry);
      o.start(); o2.start();
      this.hums.push({ g, p, lamp: null });
    }
    // lanterna: zumbido do foco / aquecimento
    this.flO = this.osc('sawtooth', 180); this.flBP = this.filt('bandpass', 900, 5); this.flG = this.gain(0);
    this.chain(this.flO, this.flBP, this.flG, this.dry); this.flO.start();
  }

  // ---------- atualizacao ----------
  update(dt, state) {
    if (!this.ready) return;
    const t = this.now();
    this.listener();
    const g = this.game, p = g.player;
    // ambiencia por zona
    const z = state.zone;
    const low = z?.level < 0;
    this.ambLP.frequency.setTargetAtTime(low ? 95 : z?.cold ? 180 : 140, t, 1.5);
    this.amb.gain.setTargetAtTime(state.blackout ? 0.2 : (low ? 0.8 : 0.55), t, 1.5);
    this.rain.gain.setTargetAtTime(z?.outside ? 0.25 : state.nearExit ? 0.03 : 0, t, 0.8);
    // respiracao
    const exert = 1 - p.stamina;
    this.fear = state.fear;
    this.breathRate = 0.22 + exert * 0.55 + this.fear * 0.35;
    this.breathPhase += dt * this.breathRate * Math.PI * 2;
    const cyc = Math.sin(this.breathPhase);
    let bv = (0.012 + exert * 0.07 + this.fear * 0.035) * (cyc > 0 ? cyc : -cyc * 0.6);
    if (p.hidden && p.holdingBreath) bv = 0;
    if (g.state !== 'playing') bv *= 0.3;
    this.breathG.gain.setTargetAtTime(bv, t, 0.05);
    this.breathF.frequency.setTargetAtTime(cyc > 0 ? 1300 + exert * 400 : 800, t, 0.1);
    // coracao: depende so da DISTANCIA da criatura (e da exaustao). Individual: cada cliente ouve o proprio.
    const on = state.heartOn !== false && !p.ghost;
    const d = state.monsterDist ?? Infinity;
    const kt = on && d < HB.farDist ? Math.pow(clamp((HB.farDist - d) / (HB.farDist - HB.nearDist), 0, 1), HB.curve) : 0;
    this.heartK = damp(this.heartK, kt, !on ? HB.offRelease : kt > this.heartK ? HB.attack : HB.release, dt);
    const kx = on ? clamp((exert - 0.5) * 2, 0, 1) : 0;
    const k = this.heartK;
    const bpm = lerp(HB.bpm[0], HB.bpm[1], k) + HB.bpmExertion * kx;
    const vol = (k > 0.004 ? lerp(HB.volume[0], HB.volume[1], k) : 0) + HB.volumeExertion * kx * (on ? 1 : 0);
    this.heartStats.k = k; this.heartStats.bpm = bpm; this.heartStats.vol = vol;
    this.heartT -= dt;
    if (this.heartT <= 0 && vol > 0.01) { this.heartT = 60 / bpm; this._beat(t, bpm, vol); this.heartStats.beats++; }
    else if (vol <= 0.01) this.heartT = Math.min(this.heartT, 0.4);
    // zumbido das lampadas
    const lamps = g.lighting?.lamps.filter(l => l.on && l.state !== 'dead' && l.type === 'fluor')
      .map(l => [Math.hypot(l.x - g.camera.position.x, l.z - g.camera.position.z) + Math.abs(l.y - g.camera.position.y), l])
      .sort((a, b) => a[0] - b[0]).slice(0, 2) || [];
    this.hums.forEach((h, i) => {
      const e = lamps[i];
      if (!e || e[0] > 14) { h.g.gain.setTargetAtTime(0, t, 0.1); return; }
      const l = e[1];
      if (h.p.positionX) { h.p.positionX.value = l.x; h.p.positionY.value = l.y; h.p.positionZ.value = l.z; }
      h.g.gain.setTargetAtTime(0.035 * l.level + (l.level < 0.5 && l.level > 0.02 ? 0.03 : 0), t, 0.02);
    });
    // eventos distantes
    this.eventT -= dt;
    if (this.eventT <= 0 && g.state === 'playing') { this.eventT = range(7, 18); this._distantEvent(); }
    if (low) { this.dripT -= dt; if (this.dripT <= 0) { this.dripT = range(0.8, 3); this._drip(); } }
    if (this.siren && this.library?.has('siren')) {
      const old = this.siren; this.siren = null;
      old.g.gain.setTargetAtTime(0, t, 0.15); old.o.stop(t + 0.6); old.lfo.stop(t + 0.6);
      this.library.loop('siren', 0.22, { fade: 0.5 }); this._sampleSiren = true;
    }
    if (this._sz && this.library?.has('burn') && g.ai?.pos) this.sizzle(true, g.ai.pos);
    this.library?.update(dt, state);
  }

  _thump(t, f, v) {
    const o = this.osc('sine', f); const g = this.gain(0);
    o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    o.connect(g); g.connect(this.heartG);
    this.env(g, t, 0.01, v, 0.22);
    o.start(t); o.stop(t + 0.3);
  }

  _randomFarPoint(minD = 12, maxD = 30) {
    const g = this.game, c = g.camera.position;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = range(minD, maxD);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const cx = g.grid.cellX(x), cy = g.grid.cellY(z);
      if (g.grid.isFloor(cx, cy)) return { x, y: g.grid.floorY(x, z) + 1.2, z };
    }
    return { x: c.x + 20, y: c.y, z: c.z };
  }

  _distantEvent() {
    const p = this._randomFarPoint();
    const k = pick(['metal', 'metal', 'slam', 'creak', 'drip', 'whisper', 'radio', 'wheel']);
    if (k === 'metal') this.metalHit(p, range(0.3, 0.6));
    else if (k === 'slam') this.doorSlam(p, 0.5);
    else if (k === 'creak') this.creak(p, 0.35);
    else if (k === 'wheel') this.creak(p, 0.25, 2.2);
    else if (k === 'whisper') this.whisper(p);
    else if (k === 'radio') this.radio(p);
    else this._drip();
  }

  // ---------- sons pontuais ----------
  // pos: passo de OUTRO jogador (posicional); sem pos: passo do proprio jogador
  footstep(surface, v, pos = null) {
    if (!this.ready) return;
    const material = footstepMaterial(surface), p = pos || this.game.player?.pos || this.game.camera.position;
    const side = pos ? 0 : (this._stepSide = -(this._stepSide || 1)) * 0.14;
    const yaw = this.game.player?.yaw || 0;
    const origin = { x: p.x + Math.cos(yaw) * side, y: p.y + 0.06, z: p.z - Math.sin(yaw) * side };
    this._sample('step_' + material, { pos: origin, volume: v * (pos ? FOOTSTEP_MIX.remote : FOOTSTEP_MIX.local) * range(0.94, 1.04), rate: range(0.985, 1.015), ref: pos ? 1.6 : 1.8, rolloff: 1.25, reverb: material === 'water' ? 0.025 : 0.035 });
    // Sem baque sintetizado durante a carga; o ruído percebido pela IA é independente.
  }

  gasp(v = 1) {
    if (!this.ready) return;
    if (this._sample('gasp', { volume: v * 0.6, reverb: 0, cooldown: 0.4 })) return;
    const t = this.now();
    const n = this.noise('pink'); const f = this.filt('bandpass', 900, 2); const g = this.gain(0);
    f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(1800, t + 0.35);
    this.chain(n, f, g, this.dry); this.env(g, t, 0.05, 0.35 * v, 0.5);
    n.start(t); n.stop(t + 0.7);
  }

  setBreathHold(on) {
    if (!this.ready) return;
    if (!on) { this.gasp(0.5); }
  }

  click(on) {
    if (!this.ready) return;
    if (this._sample(on ? 'click_on' : 'click_off', { volume: 0.5, reverb: 0 })) return;
    const t = this.now();
    const n = this.noise('white'); const f = this.filt('highpass', on ? 3500 : 2500, 1); const g = this.gain(0);
    this.chain(n, f, g, this.dry); this.env(g, t, 0.001, 0.35, 0.03); n.start(t); n.stop(t + 0.08);
  }
  thump() { if (!this.ready) return; if (this._sample('flashlight_thump', { volume: 0.5, reverb: 0 })) return; const t = this.now(); this._thump(t, 90, 0.5); this.metalHit(this.game.camera.position, 0.15, true); }

  setFlashlightHum(focus, heat) {
    if (!this.ready) return;
    const t = this.now();
    if (this.library?.loop('hum_flashlight', focus * (0.04 + heat * 0.08), { fade: 0.08 })) { this.flG.gain.setTargetAtTime(0, t, 0.05); return; }
    this.flO.frequency.setTargetAtTime(160 + heat * 380, t, 0.05);
    this.flBP.frequency.setTargetAtTime(700 + heat * 2200, t, 0.05);
    this.flG.gain.setTargetAtTime(focus * (0.025 + heat * 0.06), t, 0.05);
  }
  overheat() {
    if (!this.ready) return;
    if (this._sample('overheat', { volume: 0.65, important: true, reverb: 0 })) return;
    const t = this.now();
    const n = this.noise('white'); const f = this.filt('highpass', 1500); const g = this.gain(0);
    this.chain(n, f, g, this.dry); this.env(g, t, 0.001, 0.6, 0.6); n.start(t); n.stop(t + 0.8);
    this._thump(t, 200, 0.4);
  }

  metalHit(pos, v = 0.5, local = false) {
    if (!this.ready) return;
    if (this._sample('metal_hit', { pos: local ? null : pos, volume: v, ref: 3, rate: range(0.93, 1.06) })) return;
    const t = this.now();
    const out = local ? { input: this.sfx } : this.spatial(pos, { ref: 3 });
    const n = this.noise('white'); const ng = this.gain(0);
    n.connect(ng); this.env(ng, t, 0.001, v, 0.05);
    for (const [f, q, d] of [[420, 18, 1.4], [1130, 25, 1.1], [2210, 30, 0.8], [3350, 30, 0.5]]) {
      const bp = this.filt('bandpass', f * range(0.9, 1.1), q); const g = this.gain(0);
      ng.connect(bp); bp.connect(g); g.connect(out.input);
      g.gain.setValueAtTime(3, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    }
    n.start(t); n.stop(t + 0.1);
  }

  doorSlam(pos, v = 1) {
    if (!this.ready) return;
    if (this._sample('door_slam', { pos, volume: v * 0.8, ref: 3, important: true, cooldown: 0.12 })) return;
    const t = this.now();
    const out = this.spatial(pos, { ref: 3 });
    const o = this.osc('sine', 70); const g = this.gain(0);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    this.chain(o, g, out.input); this.env(g, t, 0.002, 1.2 * v, 0.35); o.start(t); o.stop(t + 0.5);
    const n = this.noise('brown'); const ng = this.gain(0);
    this.chain(n, this.filt('lowpass', 900), ng, out.input); this.env(ng, t, 0.002, 1.5 * v, 0.25); n.start(t); n.stop(t + 0.4);
    this.metalHit(pos, 0.25 * v);
  }

  doorRattle(pos) {
    if (!this.ready) return;
    if (this._sample('door_rattle', { pos, volume: 0.65, cooldown: 0.3 })) return;
    const t = this.now();
    const out = this.spatial(pos, { ref: 2.5 });
    for (let i = 0; i < 4; i++) {
      const n = this.noise('white'); const g = this.gain(0);
      this.chain(n, this.filt('bandpass', 700 + i * 90, 3), g, out.input);
      this.env(g, t + i * 0.12, 0.002, 0.6, 0.08); n.start(t + i * 0.12); n.stop(t + i * 0.12 + 0.12);
    }
  }

  creak(pos, v = 0.5, dur = 1.1) {
    if (!this.ready) return;
    if (this._sample('door_creak', { pos, volume: v * 1.1, rate: clamp(1.4 / dur, 0.8, 1.2) })) return;
    const t = this.now();
    const out = pos ? this.spatial(pos) : { input: this.sfx };
    const o = this.osc('sawtooth', 300);
    const lfo = this.osc('sine', 23); const lg = this.gain(60);
    lfo.connect(lg); lg.connect(o.frequency);
    o.frequency.setValueAtTime(range(250, 380), t); o.frequency.linearRampToValueAtTime(range(420, 620), t + dur);
    const bp = this.filt('bandpass', 1400, 6); const g = this.gain(0);
    this.chain(o, bp, g, out.input);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(v * 0.25, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  doorOpen(pos, fast) { if (fast) this.doorSlam(pos, 0.6); else this.creak(pos, 0.45, range(0.8, 1.3)); }
  doorClose(pos) { if (!this.ready) return; if (this._sample('door_close', { pos, volume: 0.6 })) return; const t = this.now(); const out = this.spatial(pos); const o = this.osc('sine', 90); const g = this.gain(0); this.chain(o, g, out.input); this.env(g, t, 0.003, 0.6, 0.2); o.start(t); o.stop(t + 0.3); this.metalHit(pos, 0.12); }
  locked(pos) { this.doorRattle(pos); }
  lockerBang(pos) { if (this._sample('locker_bang', { pos, volume: 0.85, important: true })) return; this.metalHit(pos, 1); this.doorSlam(pos, 0.5); }
  lockerMove(pos) { if (this._sample('locker_move', { pos, volume: 0.45 })) return; this.metalHit(pos, 0.2); this.creak(pos, 0.15, 0.4); }

  drawer(pos) {
    if (!this.ready) return;
    if (this._sample('drawer', { pos, volume: 0.6 })) return;
    const t = this.now(), out = this.spatial(pos);
    const n = this.noise('white'); const f = this.filt('bandpass', 2600, 4); const g = this.gain(0);
    const lfo = this.osc('square', 34); const lg = this.gain(0.15); lfo.connect(lg); lg.connect(g.gain);
    this.chain(n, f, g, out.input);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + 0.8);
    n.start(t); lfo.start(t); n.stop(t + 0.85); lfo.stop(t + 0.85);
    this.metalHit(pos, 0.2);
  }

  pickup(kind) {
    if (!this.ready) return;
    if (this._sample(kind === 'note' || kind === 'map' ? 'pickup_paper' : kind === 'key' ? 'pickup_key' : 'pickup_fuse', { volume: 0.45, reverb: 0 })) return;
    const t = this.now();
    if (kind === 'note' || kind === 'map') {
      const n = this.noise('pink'); const f = this.filt('bandpass', 3000, 0.8); const g = this.gain(0);
      const lfo = this.osc('sine', 18); const lg = this.gain(0.2); lfo.connect(lg); lg.connect(g.gain);
      this.chain(n, f, g, this.sfx); this.env(g, t, 0.02, 0.3, 0.4); n.start(t); lfo.start(t); n.stop(t + 0.5); lfo.stop(t + 0.5);
      return;
    }
    const f0 = kind === 'fuse' ? 1800 : kind === 'key' ? 2600 : 1200;
    for (let i = 0; i < (kind === 'key' ? 4 : 2); i++) {
      const o = this.osc('sine', f0 * range(0.95, 1.4)); const g = this.gain(0);
      this.chain(o, g, this.sfx); this.env(g, t + i * 0.07, 0.001, 0.15, 0.25); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
    }
  }

  fuseInsert(pos) {
    if (!this.ready) return;
    if (this._sample('fuse_insert', { pos, volume: 0.65, important: true })) return;
    const t = this.now();
    this.metalHit(pos, 0.4);
    this._thump(t + 0.05, 60, 0.6);
    const o = this.osc('sawtooth', 50); const bp = this.filt('lowpass', 400); const g = this.gain(0);
    o.frequency.setValueAtTime(40, t + 0.1); o.frequency.linearRampToValueAtTime(120, t + 1.2);
    this.chain(o, bp, g, this.sfx); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + 1.6);
    o.start(t); o.stop(t + 1.7);
  }

  lightsOn() {
    if (!this.ready) return;
    if (this._sample('lights_on', { volume: 0.4 })) return;
    const t = this.now();
    for (let i = 0; i < 6; i++) {
      const o = this.osc('square', range(2800, 4200)); const g = this.gain(0);
      this.chain(o, this.filt('highpass', 2000), g, this.sfx);
      const tt = t + 0.2 + i * range(0.08, 0.3);
      this.env(g, tt, 0.001, 0.04, 0.05); o.start(tt); o.stop(tt + 0.08);
    }
  }

  lampBurst(pos) {
    if (!this.ready) return;
    if (this._sample('lamp_burst', { pos, volume: 0.7, ref: 3, important: true })) return;
    const t = this.now(), out = this.spatial(pos, { ref: 3 });
    const n = this.noise('white'); const g = this.gain(0);
    this.chain(n, this.filt('highpass', 2500), g, out.input); this.env(g, t, 0.001, 1.2, 0.35); n.start(t); n.stop(t + 0.5);
    for (let i = 0; i < 8; i++) { const tt = t + 0.1 + Math.random() * 0.6; const o = this.osc('sine', range(3000, 7000)); const og = this.gain(0); this.chain(o, og, out.input); this.env(og, tt, 0.001, 0.08, 0.1); o.start(tt); o.stop(tt + 0.15); }
  }

  lever() {
    if (!this.ready) return;
    if (this._sample('lever', { volume: 0.7, important: true })) return;
    const t = this.now();
    this.metalHit(this.game.camera.position, 0.6, true);
    this._thump(t, 50, 1);
  }

  startSiren() {
    if (!this.ready || this.siren) return;
    if (this.library?.loop('siren', 0.22, { fade: 0.7 })) { this._sampleSiren = true; return; }
    const t = this.now();
    const o = this.osc('sawtooth', 600); const lfo = this.osc('sine', 0.7); const lg = this.gain(220);
    lfo.connect(lg); lg.connect(o.frequency);
    const g = this.gain(0);
    this.chain(o, this.filt('bandpass', 900, 1.5), this.dist(5), g);
    g.connect(this.dry); g.connect(this.revSend);
    g.gain.setTargetAtTime(0.09, t, 0.5);
    o.start(t); lfo.start(t);
    this.siren = { o, lfo, g };
  }
  stopSiren() { this.library?.loop('siren', 0); this._sampleSiren = false; if (!this.siren) return; const t = this.now(); this.siren.g.gain.setTargetAtTime(0, t, 0.3); this.siren.o.stop(t + 1.5); this.siren.lfo.stop(t + 1.5); this.siren = null; }

  unlock() {
    if (!this.ready) return;
    if (this._sample('unlock', { volume: 0.65, important: true })) return;
    const t = this.now();
    this._thump(t, 45, 1);
    const n = this.noise('white'); const g = this.gain(0);
    this.chain(n, this.filt('bandpass', 5000, 0.5), g, this.sfx); this.env(g, t + 0.1, 0.05, 0.3, 1.2); n.start(t); n.stop(t + 1.5);
  }

  ventRattle(pos) { if (this._sample('vent_rattle', { pos, volume: 0.65, occl: 550, important: true })) return; this.metalHit(pos, 0.5); this.doorRattle(pos); }
  ventTravel(from, to, dur) {
    if (!this.ready) return;
    const n = Math.floor(dur * 3);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      setTimeout(() => {
        if (!this.ready) return;
        const pos = { x: from.x + (to.x - from.x) * k, y: from.base + 2.9, z: from.z + (to.z - from.z) * k };
        if (this.game.state !== 'playing') return;
        if (this._sample('vent_crawl', { pos, volume: 0.4, occl: 400, cooldown: 1.1 })) return;
        this.metalHit(pos, range(0.15, 0.35));
        const t = this.now(); const out = this.spatial(pos, { occl: 400 });
        const o = this.osc('sine', 70); const g = this.gain(0); this.chain(o, g, out.input); this.env(g, t, 0.003, 0.4, 0.15); o.start(t); o.stop(t + 0.2);
      }, (k * dur + Math.random() * 0.2) * 1000);
    }
  }

  whisper(pos) {
    if (!this.ready) return;
    if (this._sample('whisper', { pos, volume: 0.42, reverb: 0.18, cooldown: 2 })) return;
    const t = this.now(), out = this.spatial(pos);
    const n = this.noise('pink');
    const f1 = this.filt('bandpass', 1800, 6), f2 = this.filt('bandpass', 3200, 8);
    const g = this.gain(0);
    n.connect(f1); n.connect(f2); f1.connect(g); f2.connect(g); g.connect(out.input);
    for (let i = 0; i < 6; i++) {
      const tt = t + i * range(0.12, 0.25);
      f1.frequency.setValueAtTime(range(900, 2400), tt);
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.12, tt + 0.05); g.gain.linearRampToValueAtTime(0.0001, tt + 0.18);
    }
    n.start(t); n.stop(t + 1.8);
  }

  radio(pos) {
    if (!this.ready) return;
    if (this._sample('radio', { pos, volume: 0.45, cooldown: 3 })) return;
    const t = this.now(), out = this.spatial(pos);
    const n = this.noise('white'); const g = this.gain(0);
    this.chain(n, this.filt('bandpass', 1600, 0.7), g, out.input);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 1.4);
    const o = this.osc('sine', 440); const og = this.gain(0); this.chain(o, og, out.input);
    og.gain.setValueAtTime(0.0001, t + 0.4); og.gain.linearRampToValueAtTime(0.04, t + 0.5); og.gain.linearRampToValueAtTime(0.0001, t + 0.9);
    n.start(t); n.stop(t + 1.5); o.start(t); o.stop(t + 1.5);
  }

  _drip() {
    if (!this.ready) return;
    const p = this._randomFarPoint(3, 10);
    if (this._sample('drip', { pos: p, volume: 0.16, ref: 1, reverb: 0.2 })) return;
    const t = this.now(), out = this.spatial(p, { ref: 1, noDuck: true });
    const o = this.osc('sine', range(900, 1600)); const g = this.gain(0);
    o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.4, t + 0.08);
    this.chain(o, g, out.input); this.env(g, t, 0.001, 0.12, 0.09); o.start(t); o.stop(t + 0.12);
  }

  // ---------- criatura ----------
  creatureCry(pos, kind) {
    if (!this.ready) return;
    const t = this.now();
    const head = { x: pos.x, y: pos.y + 2, z: pos.z };
    // A captura conserva a vocalização original; os demais sons usam os masters.
    if (kind !== 'attack' && this._sample('creature_' + kind, { pos: head, volume: ['roar', 'attack', 'screech'].includes(kind) ? 0.95 : 0.7, ref: ['roar', 'screech'].includes(kind) ? 4 : 2, important: true, cooldown: kind === 'pain' ? 0.6 : 0.35 })) return;
    const out = this.spatial(head, { ref: kind === 'roar' || kind === 'screech' ? 4 : 2 });
    const into = out.input;
    if (kind === 'click') {
      const n = range(6, 13) | 0;
      let tt = t;
      for (let i = 0; i < n; i++) {
        tt += range(0.025, 0.07);
        const s = this.noise('white'); const g = this.gain(0);
        this.chain(s, this.filt('bandpass', range(1800, 3200), 8), g, into);
        this.env(g, tt, 0.0005, range(0.5, 0.9), 0.02); s.start(tt, Math.random()); s.stop(tt + 0.04);
      }
    } else if (kind === 'breath' || kind === 'sniff') {
      const reps = kind === 'sniff' ? 4 : 2;
      for (let i = 0; i < reps; i++) {
        const tt = t + i * (kind === 'sniff' ? 0.22 : 0.9);
        const s = this.noise('pink'); const f = this.filt('bandpass', kind === 'sniff' ? 1600 : 600, 2); const g = this.gain(0);
        this.chain(s, f, g, into);
        g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(kind === 'sniff' ? 0.5 : 0.35, tt + 0.08); g.gain.linearRampToValueAtTime(0.0001, tt + (kind === 'sniff' ? 0.16 : 0.7));
        s.start(tt, Math.random()); s.stop(tt + 0.8);
        if (kind === 'breath') { const o = this.osc('sawtooth', 58); const og = this.gain(0); this.chain(o, this.filt('lowpass', 300), og, into); og.gain.setValueAtTime(0.0001, tt); og.gain.linearRampToValueAtTime(0.12, tt + 0.2); og.gain.linearRampToValueAtTime(0.0001, tt + 0.7); o.start(tt); o.stop(tt + 0.8); }
      }
    } else if (kind === 'pain') {
      // gemido curto e rouco: acompanha a reacao de dor quando a luz comeca a queimar
      const dur = 0.45;
      const o = this.osc('sawtooth', 420);
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(240, t + dur);
      const vib = this.osc('sine', 38); const vg = this.gain(40); vib.connect(vg); vg.connect(o.frequency);
      const g = this.gain(0), d = this.dist(10);
      this.chain(o, this.filt('bandpass', 1500, 2.2), g, d, into);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const n = this.noise('white'), ng = this.gain(0);
      this.chain(n, this.filt('highpass', 3000, 0.7), ng, into); this.env(ng, t, 0.005, 0.22, 0.18);
      o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
      n.start(t, Math.random()); n.stop(t + 0.25);
    } else if (kind === 'moan' || kind === 'growl') {
      const dur = kind === 'moan' ? 2.2 : 1.1;
      const o = this.osc('sawtooth', kind === 'moan' ? 95 : 70);
      o.frequency.setValueAtTime(kind === 'moan' ? 120 : 75, t); o.frequency.linearRampToValueAtTime(kind === 'moan' ? 70 : 60, t + dur);
      const am = this.osc('sine', kind === 'growl' ? 28 : 5); const ag = this.gain(0.4);
      const g = this.gain(0);
      am.connect(ag); ag.connect(g.gain);
      const f1 = this.filt('bandpass', 500, 4), f2 = this.filt('bandpass', 1100, 5);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g);
      const d = this.dist(8); g.connect(d); d.connect(into);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.start(t); am.start(t); o.stop(t + dur + 0.1); am.stop(t + dur + 0.1);
    } else if (kind === 'roar' || kind === 'attack' || kind === 'screech' || kind === 'hiss') {
      const dur = kind === 'screech' ? 1.6 : kind === 'hiss' ? 0.8 : kind === 'attack' ? 1.2 : 2.0;
      const base = kind === 'screech' ? 900 : kind === 'hiss' ? 0 : 210;
      const g = this.gain(0);
      const d = this.dist(kind === 'screech' ? 30 : 18);
      g.connect(d); d.connect(into);
      if (base) {
        for (let i = 0; i < 4; i++) {
          const o = this.osc('sawtooth', base * (1 + i * 0.13));
          const vib = this.osc('sine', range(6, 11)); const vg = this.gain(base * 0.04);
          vib.connect(vg); vg.connect(o.frequency);
          o.frequency.setValueAtTime(base * (1 + i * 0.13) * 0.8, t);
          o.frequency.linearRampToValueAtTime(base * (1 + i * 0.13) * (kind === 'screech' ? 2.4 : 1.6), t + dur * 0.3);
          o.frequency.linearRampToValueAtTime(base * (1 + i * 0.13) * 0.7, t + dur);
          const f = this.filt('bandpass', kind === 'screech' ? 2600 : 1200, 2);
          this.chain(o, f, g);
          o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
        }
      }
      const n = this.noise('white'); const nf = this.filt(kind === 'hiss' ? 'highpass' : 'bandpass', kind === 'hiss' ? 3000 : 1800, 0.8);
      const ng = this.gain(kind === 'hiss' ? 0.6 : 0.3);
      this.chain(n, nf, ng, g); n.start(t); n.stop(t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(kind === 'attack' ? 1.0 : 0.7, t + 0.08);
      g.gain.linearRampToValueAtTime(0.4, t + dur * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      if (kind === 'attack') this._originalStinger(1);
      else if (kind === 'roar') this.stinger(0.6);
    }
  }

  sizzle(on, pos) {
    if (!this.ready) return;
    const t = this.now();
    if (this.library?.loop('burn', on ? 0.4 : 0, on ? { pos: { x: pos.x, y: pos.y + 2, z: pos.z }, ref: 3, fade: 0.05 } : {})) {
      if (this._sz) { const s = this._sz; this._sz = null; s.g.gain.setTargetAtTime(0, t, 0.05); s.n.stop(t + 0.2); s.am.stop(t + 0.2); }
      return;
    }
    if (on && !this._sz) {
      const out = this.spatial({ x: pos.x, y: pos.y + 2, z: pos.z }, { ref: 3 });
      const n = this.noise('white', true); const g = this.gain(0);
      const am = this.noise('white', true); const amf = this.filt('lowpass', 40); const amg = this.gain(0.6);
      this.chain(am, amf, amg, g.gain);
      this.chain(n, this.filt('highpass', 3500), g, out.input);
      g.gain.setTargetAtTime(0.35, t, 0.05);
      n.start(t); am.start(t);
      this._sz = { n, am, g };
    } else if (!on && this._sz) {
      const s = this._sz; this._sz = null;
      s.g.gain.setTargetAtTime(0, t, 0.08); s.n.stop(t + 0.5); s.am.stop(t + 0.5);
    }
  }

  creatureSteps(ai, dt) {
    if (!this.ready || !ai.visibleModel && ai.state === 'vent') return;
    const s = ai.moveSpeed;
    if (s < 0.3) return;
    ai._stepT = (ai._stepT ?? 0) - dt;
    if (ai._stepT > 0) return;
    ai._stepT = clamp(1.1 / s, 0.22, 0.9);
    const pos = { x: ai.pos.x, y: ai.pos.y + 0.12, z: ai.pos.z };
    const nearby = Math.hypot(pos.x - this.game.camera.position.x, pos.z - this.game.camera.position.z) < 22;
    const opts = { pos, ref: 3.2, rolloff: 0.85, rate: range(0.98, 1.02), reverb: 0.06 };
    if (this._sample('creature_step', { ...opts, volume: s > 3 ? FOOTSTEP_MIX.creatureRun : FOOTSTEP_MIX.creatureWalk, important: true, duckDuration: nearby ? 0.18 : 0, duckLevel: 0.72 })) {
      this._sample('step_' + footstepMaterial(footstepSurfaceAt(this.game, ai.pos.x, ai.pos.z)), { ...opts, volume: FOOTSTEP_MIX.creatureSurface });
      return;
    }
    const t = this.now();
    const out = this.spatial({ x: ai.pos.x, y: ai.pos.y + 0.2, z: ai.pos.z }, { ref: 2.2 });
    const o = this.osc('sine', 60); const g = this.gain(0);
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    this.chain(o, g, out.input); this.env(g, t, 0.003, s > 3 ? 0.9 : 0.5, 0.16); o.start(t); o.stop(t + 0.2);
    const n = this.noise('brown'); const ng = this.gain(0);
    this.chain(n, this.filt('lowpass', 700), ng, out.input); this.env(ng, t, 0.003, s > 3 ? 1.2 : 0.6, 0.12); n.start(t, Math.random()); n.stop(t + 0.2);
    if (Math.random() < 0.25) {
      const c = this.noise('white'); const cg = this.gain(0);
      this.chain(c, this.filt('bandpass', 2600, 6), cg, out.input); this.env(cg, t + 0.05, 0.0005, 0.4, 0.02); c.start(t + 0.05); c.stop(t + 0.1);
    }
  }

  stinger(v = 0.6) {
    if (!this.ready) return;
    if (this._sample('stinger', { volume: v * 0.65, important: true, reverb: 0, cooldown: 4 })) return;
    this._originalStinger(v);
  }

  _originalStinger(v) {
    const t = this.now();
    const g = this.gain(0); g.connect(this.dry); g.connect(this.revSend);
    for (const f of [110, 116.5, 164.8, 233, 246.9]) {
      const o = this.osc('sawtooth', f); const lp = this.filt('lowpass', 400, 2);
      lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.8);
      this.chain(o, lp, g); o.start(t); o.stop(t + 2.2);
    }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1 * v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    this._thump(t, 38, v);
  }

  death() {
    if (!this.ready) return;
    const t = this.now();
    this._originalStinger(1.2);
    const o = this.osc('sine', 4200); const g = this.gain(0);
    this.chain(o, g, this.dry); g.gain.setValueAtTime(0.0001, t + 0.3); g.gain.linearRampToValueAtTime(0.05, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.start(t); o.stop(t + 4.2);
  }
}
