// Reprodução local de masters ElevenLabs. O navegador nunca chama a API paga.
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const MUSIC = new Set(['score_explore', 'score_basement', 'score_stalk', 'score_chase', 'score_finale', 'score_escape']);
const LOOPS = new Set(['amb_hospital', 'amb_basement', 'amb_morgue', 'amb_noturna', 'amb_boiler', 'amb_water', 'amb_rain', 'breath_calm', 'breath_panic', 'hum_lamp', 'hum_flashlight', 'siren', 'burn', 'children_laughter']);

export function soundscape(game, state) {
  const playing = game.state === 'playing' || !!game.online && game.state === 'paused';
  const active = playing || ['reading', 'map'].includes(game.state);
  const ai = game.ai;
  const localDanger = (state.monsterDist ?? Infinity) < 22;
  const chase = playing && localDanger && ['chase', 'attack'].includes(ai?.state);
  const hidden = !!game.player?.hidden;
  const finale = !!(game.director?.finale || game.objectives?.charging || ai?.enraged);
  const tension = clamp(state.fear || 0);
  const escaped = game.state === 'won' || game.online?.players?.get(game.online.me)?.status === 'escaped';
  let music = null;
  if (escaped) music = 'score_escape';
  else if (active) {
    if (chase && !hidden) music = 'score_chase';
    else if (finale && !hidden) music = 'score_finale';
    else if (tension > 0.38 || (hidden && localDanger)) music = 'score_stalk';
    else music = state.zone?.level < 0 ? 'score_basement' : 'score_explore';
  }
  const zone = state.zone;
  const ambience = !active ? null : zone?.outside ? 'amb_rain' : zone?.amb === 'noturna' ? 'amb_noturna' : zone?.cold ? 'amb_morgue' : zone?.water ? 'amb_water' : zone?.amb === 'boiler' || zone?.amb === 'generator' ? 'amb_boiler' : zone?.level < 0 ? 'amb_basement' : 'amb_hospital';
  return { active, playing, hidden, tension, music, ambience, musicLevel: escaped ? 0.55 : !active ? 0 : (hidden ? 0.13 : chase ? 0.38 : finale ? 0.34 : 0.23) * (playing ? 1 : 0.5) };
}

export class AudioLibrary {
  constructor(host) {
    this.host = host;
    this.ctx = host.ctx;
    this.entries = {};
    this.buffers = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.lastVariant = new Map();
    this.variantBags = new Map();
    this.lastPlay = new Map();
    this.voices = new Set();
    this.loops = new Map();
    this.musicId = null;
    this.musicCandidate = null;
    this.candidateTime = 0;
    this.ghostTimer = 24;
    this.duckUntil = 0;
    this.duckLevel = 1;
    this.stats = { manifest: 'loading', decoded: 0, failed: 0, played: 0, activeVoices: 0, music: null, ambience: null };
    this.loaded = this.load();
  }
  async load() {
    try {
      const response = await fetch(new URL('../../assets/audio/manifest.json', import.meta.url), { cache: 'no-cache' });
      if (!response.ok) throw new Error('manifest');
      const manifest = await response.json();
      if (manifest.version !== 1 || !manifest.assets || typeof manifest.assets !== 'object') throw new Error('manifest version');
      // Somente arquivos locais de áudio podem entrar no grafo.
      for (const [id, list] of Object.entries(manifest.assets)) {
        if (Array.isArray(list) && list.length && list.every(e => /^[a-z0-9_]+\.ogg$/.test(e.file))) this.entries[id] = list;
      }
      this.stats.manifest = manifest.status || 'loaded';
      for (const id of ['breath_calm', 'breath_panic', 'siren', 'burn', 'children_laughter', 'toy_music']) void this.ensure(id);
      for (const id of ['score_explore', 'score_chase']) void this.ensure(id);
      const ids = Object.keys(this.entries).filter(id => !MUSIC.has(id) && !LOOPS.has(id)).sort((a, b) => Number(b.startsWith('step_') || b === 'creature_step') - Number(a.startsWith('step_') || a === 'creature_step'));
      // Três downloads/decodificações simultâneos; camas e trilhas sob demanda.
      let next = 0;
      await Promise.all(Array.from({ length: 3 }, async () => { while (next < ids.length) await this.ensure(ids[next++]); }));
    } catch {
      this.stats.manifest = 'unavailable';
    }
    return this.stats;
  }
  has(id) { return this.buffers.has(id); }
  ensure(id) {
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    if (!this.entries[id] || this.failed.has(id)) return Promise.resolve(null);
    const job = (async () => {
      try {
        const result = [];
        for (const entry of this.entries[id]) {
          const version = /^[a-f0-9]{64}$/.test(entry.sha256 || '') ? '?v=' + entry.sha256.slice(0, 12) : '';
          const response = await fetch(new URL('../../assets/audio/' + entry.file + version, import.meta.url));
          if (!response.ok) throw new Error('asset');
          const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
          if (!Number.isFinite(buffer.duration) || buffer.duration < 0.05) throw new Error('decode');
          result.push(buffer);
        }
        this.buffers.set(id, result);
        this.stats.decoded += result.length;
        return result;
      } catch {
        this.failed.add(id); this.stats.failed++;
        return null;
      } finally { this.pending.delete(id); }
    })();
    this.pending.set(id, job);
    return job;
  }
  _buffer(id) {
    const list = this.buffers.get(id);
    if (!list) { void this.ensure(id); return null; }
    let bag = this.variantBags.get(id);
    if (!bag?.length) {
      bag = Array.from({ length: list.length }, (_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.length > 1 && bag[bag.length - 1] === this.lastVariant.get(id)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      this.variantBags.set(id, bag);
    }
    const index = bag.pop();
    this.lastVariant.set(id, index);
    return list[index];
  }
  _route(gain, opts) {
    const nodes = [];
    let output = gain;
    let panner = null;
    let filter = null, muffle = null;
    if (opts.pos) {
      filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.7;
      muffle = this.ctx.createGain();
      gain.connect(filter); filter.connect(muffle); output = muffle; nodes.push(filter, muffle);
      panner = this.ctx.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = opts.ref ?? 2; panner.maxDistance = 60; panner.rolloffFactor = opts.rolloff ?? 1.1;
      // HRTF recebe fonte mono: a gravação não carrega uma direção estéreo falsa.
      panner.channelCount = 1; panner.channelCountMode = 'explicit';
      this._position(panner, opts.pos);
      output.connect(panner); output = panner; nodes.push(panner);
    } else if (opts.pan !== undefined) {
      const pan = this.ctx.createStereoPanner(); pan.pan.value = clamp(opts.pan, -1, 1);
      output.connect(pan); output = pan; nodes.push(pan);
    }
    output.connect(opts.destination || this.host.dry);
    if ((opts.reverb ?? 0.12) > 0) {
      const send = this.ctx.createGain(); send.gain.value = opts.reverb ?? 0.12;
      output.connect(send); send.connect(this.host.revSend); nodes.push(send);
    }
    const route = { nodes, panner, filter, muffle, pos: opts.pos ? { ...opts.pos } : null, opts, lastCheck: -Infinity, occluded: false };
    this._refreshSpatial(route, true);
    return route;
  }
  _refreshSpatial(route, immediate = false) {
    if (!route.panner) return;
    const now = this.ctx.currentTime;
    if (!immediate && now - route.lastCheck < 0.08) return;
    route.lastCheck = now;
    const cam = this.host.game.camera.position, pos = route.pos, grid = this.host.game.grid;
    const distance = Math.hypot(cam.x - pos.x, cam.y - pos.y, cam.z - pos.z);
    route.occluded = !!grid && (!grid.segmentClear(cam.x, cam.z, pos.x, pos.z, true) || Math.abs(cam.y - pos.y) > 3);
    const cutoff = route.occluded ? (route.opts.occl ?? 850) : Math.max(3500, 20000 / (1 + distance * 0.035));
    const level = route.occluded ? (route.opts.occlGain ?? 0.55) : 1;
    if (immediate) { route.filter.frequency.value = cutoff; route.muffle.gain.value = level; }
    else { route.filter.frequency.setTargetAtTime(cutoff, now, 0.06); route.muffle.gain.setTargetAtTime(level, now, 0.06); }
  }
  updateSpatial() {
    for (const voice of this.voices) this._refreshSpatial(voice.route);
    for (const loop of this.loops.values()) this._refreshSpatial(loop.route);
  }
  _position(panner, pos) {
    if (panner.positionX) { panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z; }
    else panner.setPosition(pos.x, pos.y, pos.z);
  }
  duck(seconds = 0.8, level = 0.3) {
    const now = this.ctx.currentTime;
    this.duckLevel = now >= this.duckUntil ? level : Math.min(this.duckLevel, level);
    this.duckUntil = Math.max(this.duckUntil, now + seconds); this.host.duckBeat?.(seconds);
  }
  play(id, opts = {}) {
    const buffer = this._buffer(id);
    if (!buffer) return false; // a síntese existente garante a pista durante o carregamento
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(id) ?? -Infinity;
    if (now - last < (opts.cooldown ?? 0)) return true;
    this.lastPlay.set(id, now);
    if (this.voices.size >= 24) {
      const victim = [...this.voices].find(v => !v.important) || this.voices.values().next().value;
      victim.stop(0.035);
    }
    const source = this.ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = clamp(opts.rate ?? 1, 0.8, 1.2);
    const gain = this.ctx.createGain(); const volume = clamp(opts.volume ?? 0.6, 0, 1.6);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + 0.004);
    source.connect(gain);
    const route = this._route(gain, id === 'heartbeat' ? { ...opts, destination: this.host.beatDuck } : opts);
    let stopped = false;
    const voice = { route, source, gain, id, important: !!opts.important, stop: (fade = 0.08) => {
      if (stopped) return; stopped = true;
      this.voices.delete(voice);
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t); gain.gain.setTargetAtTime(0, t, Math.max(0.004, fade / 3));
      source.stop(t + fade);
    } };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); route.nodes.forEach(n => n.disconnect());
      this.voices.delete(voice); this.stats.activeVoices = this.voices.size;
    };
    if (opts.important) this.duck(opts.duckDuration ?? Math.min(1.3, buffer.duration), opts.duckLevel ?? 0.3);
    source.start(now, clamp(opts.offset ?? 0, 0, Math.max(0, buffer.duration - 0.01)));
    this.stats.played++; this.stats.activeVoices = this.voices.size;
    return true;
  }
  stopId(id, fade = 0.08) {
    for (const voice of [...this.voices]) if (voice.id === id) voice.stop(fade);
  }
  moveVoice(voice, pos) {
    if (!this.voices.has(voice) || !voice.route.panner) return;
    voice.route.pos = { ...pos };
    this._position(voice.route.panner, pos);
    this._refreshSpatial(voice.route);
  }
  // Fontes sobrepostas evitam cortes nas fronteiras da música e das camas.
  loop(id, volume, opts = {}) {
    let loop = this.loops.get(id);
    if (volume <= 0) {
      if (loop) { loop.target = 0; loop.gain.gain.setTargetAtTime(0, this.ctx.currentTime, opts.fade ?? 0.55); }
      return this.has(id);
    }
    const buffer = this.buffers.get(id)?.[0];
    if (!buffer) { void this.ensure(id); return false; }
    const now = this.ctx.currentTime;
    if (!loop) {
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      const route = this._route(gain, { reverb: 0, ...opts });
      loop = { id, buffer, gain, route, sources: new Map(), next: now, target: volume, lastActive: now, once: !!opts.once, spawned: false };
      this.loops.set(id, loop);
    }
    loop.target = volume; loop.lastActive = now;
    if (opts.pos && loop.route.panner) { loop.route.pos = { ...opts.pos }; this._position(loop.route.panner, opts.pos); }
    loop.gain.gain.setTargetAtTime(volume, now, opts.fade ?? 0.7);
    this._schedule(loop);
    return true;
  }
  _schedule(loop) {
    const now = this.ctx.currentTime;
    if (loop.target <= 0 || loop.once && loop.spawned || loop.next > now + 0.6) return;
    const source = this.ctx.createBufferSource(); source.buffer = loop.buffer;
    const envelope = this.ctx.createGain();
    source.connect(envelope); envelope.connect(loop.gain);
    const start = Math.max(now, loop.next), duration = loop.buffer.duration;
    const cross = Math.min(MUSIC.has(loop.id) ? 2.5 : 0.7, duration * 0.15);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + cross);
    if (!loop.once) {
      envelope.gain.setValueAtTime(1, start + duration - cross);
      envelope.gain.linearRampToValueAtTime(0, start + duration);
    }
    loop.sources.set(source, envelope); loop.spawned = true;
    source.onended = () => { source.disconnect(); envelope.disconnect(); loop.sources.delete(source); };
    source.start(start);
    loop.next = start + duration - cross;
  }
  _release(loop) {
    for (const [source, envelope] of loop.sources) { source.onended = null; source.stop(); source.disconnect(); envelope.disconnect(); }
    loop.sources.clear(); loop.gain.disconnect(); loop.route.nodes.forEach(n => n.disconnect());
    this.loops.delete(loop.id);
    // Música decodificada ocupa memória; manter apenas trilhas em reprodução.
    if (MUSIC.has(loop.id) && !['score_explore', 'score_chase'].includes(loop.id)) this.buffers.delete(loop.id);
  }
  reset() {
    for (const voice of [...this.voices]) voice.stop();
    for (const loop of [...this.loops.values()]) this._release(loop);
    this.musicId = null; this.musicCandidate = null; this.candidateTime = 0;
    this.ghostTimer = 24; this.wasBlackout = false; this.wasHolding = false;
    this.lastPlay.clear(); this.duckUntil = 0; this.duckLevel = 1;
    this.variantBags.clear(); this.lastVariant.clear();
  }
  update(dt, state) {
    const game = this.host.game, p = game.player;
    if (!p) return;
    this.updateSpatial();
    if (game.state === 'playing' && ['lobby', 'ended', 'title', 'loading'].includes(this.previousState)) this.reset();
    this.previousState = game.state;
    const now = this.ctx.currentTime, mix = soundscape(game, state);
    const wanted = new Set();
    const bed = (id, level, opts) => { wanted.add(id); return this.loop(id, level, opts); };
    if (mix.music !== this.musicCandidate) { this.musicCandidate = mix.music; this.candidateTime = 0; }
    this.candidateTime += dt;
    const urgent = mix.music === 'score_chase' || mix.music === 'score_escape' || !mix.active;
    if (mix.music !== this.musicId && (urgent || !this.musicId || this.candidateTime > 2.5)) {
      if (!mix.music || this.has(mix.music)) this.musicId = mix.music;
      else void this.ensure(mix.music);
    }
    if (this.musicId) bed(this.musicId, mix.musicLevel * (now < this.duckUntil ? this.duckLevel : 1) * (game.haunting?.toyActive ? 0.65 : 1), { fade: 1.1, once: this.musicId === 'score_escape' });
    const laughter = game.state === 'playing' && !p.dead && !p.ghost ? game.haunting?.laughter : null;
    bed('children_laughter', laughter?.volume ?? 0, laughter ? { pos: laughter.pos, ref: 2.8, rolloff: 1.1, fade: 1.5, reverb: 0.06, occl: 1800, occlGain: 0.65 } : { fade: 1.5 });
    const ambience = mix.ambience && bed(mix.ambience, mix.hidden ? 0.4 : 0.6, { fade: 1.1 });
    this.stats.music = this.musicId; this.stats.ambience = ambience ? mix.ambience : null;
    // Síntese é silenciada somente depois que a cama correspondente existe.
    if (ambience) {
      this.host.amb.gain.setTargetAtTime(0, now, 0.7);
      if (mix.ambience === 'amb_rain') this.host.rain.gain.setTargetAtTime(0, now, 0.7);
    }
    const exertion = 1 - p.stamina;
    const panic = clamp(exertion * 0.8 + mix.tension * 0.55);
    const breathing = mix.active && !p.dead && !p.ghost && !(p.hidden && p.holdingBreath);
    const calm = bed('breath_calm', breathing ? (1 - panic) * 0.13 : 0, { fade: 0.08 });
    const strained = bed('breath_panic', breathing ? panic * 0.3 : 0, { fade: 0.08 });
    if (calm && strained) this.host.breathG.gain.setTargetAtTime(0, now, 0.05);
    const lamp = game.lighting?.lamps?.filter(l => l.on && l.state !== 'dead' && l.type === 'fluor').map(l => ({ l, d: Math.hypot(l.x - game.camera.position.x, l.z - game.camera.position.z) })).sort((a,b) => a.d - b.d)[0];
    const hum = bed('hum_lamp', mix.active && lamp?.d < 14 ? 0.16 * lamp.l.level : 0, lamp ? { pos: { x: lamp.l.x, y: lamp.l.y, z: lamp.l.z }, ref: 1.2 } : {});
    if (hum) this.host.hums?.forEach(h => h.g.gain.setTargetAtTime(0, now, 0.06));
    const burning = this.loops.get('burn');
    if (burning?.route.panner && game.ai?.pos) { burning.route.pos = { x: game.ai.pos.x, y: game.ai.pos.y + 2, z: game.ai.pos.z }; this._position(burning.route.panner, burning.route.pos); }
    if (mix.playing && state.blackout && !this.wasBlackout) this.play('blackout', { volume: 0.6, important: true, cooldown: 8 });
    this.wasBlackout = !!state.blackout;
    // Presenças adicionais não imitam passos nem abafam uma perseguição.
    if (mix.playing && !mix.hidden && !['chase','attack','inspect'].includes(game.ai?.state) && !game.haunting?.toyActive && !(game.haunting?.quietTimer > 0) && !(game.paranoia?.strength > 0.55)) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 28 + Math.random() * 32;
        const ids = ['spirit_knock', 'spirit_scrape', 'spirit_lament', 'whisper'];
        this.play(ids[Math.floor(Math.random() * ids.length)], { pos: this.host._randomFarPoint(7, 19), volume: 0.32, ref: 3, reverb: 0.2, cooldown: 14 });
      }
    }
    // Loops acionados por eventos são geridos pelos métodos correspondentes.
    for (const id of ['siren', 'burn', 'hum_flashlight']) if (this.loops.get(id)?.target > 0) wanted.add(id);
    for (const loop of [...this.loops.values()]) {
      if (!wanted.has(loop.id) || !mix.active && loop.id !== 'score_escape') this.loop(loop.id, 0);
      this._schedule(loop);
      if (loop.target <= 0 && now - loop.lastActive > 6) this._release(loop);
    }
  }
}
