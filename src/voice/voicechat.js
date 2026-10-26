// Voz de proximidade por WebRTC (malha ponto a ponto). O servidor so faz a SINALIZACAO (e recusa repassar entre morto e vivo);
// o audio nao passa pelo servidor. Cada ouvinte calcula o proprio efeito de radio por distancia (radio.js).
//
// Regras: vivos falam com vivos; espiritos (mortos/escapados) so com espiritos. Quando alguem morre, os vivos FECHAM a conexao
// com essa pessoa (e ela com eles): nao e so esconder icone ou abaixar volume. Reconectar nao muda isso (o estado esta no servidor).
import * as THREE from 'three';
import { RadioVoice, VOICE } from './radio.js';
import { clamp } from '../core/rng.js';

const PREF_KEY = 'apagao.voice.v1';

export const MIC_STATUS = {
  off: 'Microfone desligado', asking: 'Aguardando permissão do microfone…', on: 'Microfone ativo', muted: 'Microfone mudo',
  denied: 'Microfone bloqueado pelo navegador — libere o acesso no ícone de cadeado da barra de endereço',
  nodevice: 'Nenhum microfone encontrado — você continua ouvindo os outros', busy: 'Microfone em uso por outro aplicativo',
  unsupported: 'Este navegador/endereço não permite microfone (é preciso HTTPS)', error: 'Falha ao abrir o microfone',
};

export class VoiceChat {
  // deps: { audio (Audio do jogo), game, signal(to, data), ice() -> Promise<RTCIceServer[]>, media? (para testes) }
  constructor(deps) {
    Object.assign(this, deps);
    this.peers = new Map();
    this.me = null; this.statusOf = new Map();    // id -> 'alive'|'dead'|'escaped'|'left'
    this.online = new Set();
    this.micStatus = 'off'; this.micStream = null; this.micTrack = null; this.muted = false;
    this.prefs = { volume: 1, deviceId: '' };
    try { Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch { /* ok */ }
    this.running = false; this.iceServers = null;
    this.noiseBuf = null; this.bus = null;
    this.onChange = null;        // (evento) => void: para a interface
  }

  // ---------- ciclo de vida ----------
  start(me, players) {
    this.running = true; this.me = me;
    this._ensureBus();
    this.setPlayers(players);
    this._ice();
    this._emit();
  }

  stop() {
    this.running = false;
    for (const id of [...this.peers.keys()]) this._close(id);
    this.releaseMic();
    this._emit();
  }

  // libera o microfone e encerra as conexoes ao sair da sala / voltar ao menu
  releaseMic() {
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { /* ok */ }
    this.micStream = null; this.micTrack = null;
    if (this.micStatus === 'on' || this.micStatus === 'muted') this.micStatus = 'off';
  }

  _ensureBus() {
    const ctx = this.audio.ctx;
    if (!ctx || this.bus) return;
    this.bus = ctx.createGain(); this.bus.gain.value = 1;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 3;
    this.bus.connect(this.comp); this.comp.connect(this.audio.master || ctx.destination);
    // ruido de radio: buffer curto em loop (o volume real e controlado por par)
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
  }

  async _ice() {
    if (this.iceServers) return this.iceServers;
    try { this.iceServers = await this.ice(); } catch { this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]; }
    return this.iceServers;
  }

  // ---------- microfone ----------
  async enableMic(deviceId = this.prefs.deviceId) {
    const md = this.media || navigator.mediaDevices;
    if (!md || !md.getUserMedia) { this._mic('unsupported'); return false; }
    this._mic('asking');
    try {
      const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false };
      let stream;
      try { stream = await md.getUserMedia(constraints); }
      catch (e) { if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { this.prefs.deviceId = ''; stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); } else throw e; }
      this.releaseMic();
      this.micStream = stream; this.micTrack = stream.getAudioTracks()[0];
      if (!this.micTrack) { this._mic('nodevice'); return false; }
      this.micTrack.enabled = !this.muted;
      this.micTrack.onended = () => { this._mic('error'); this.micTrack = null; for (const p of this.peers.values()) p.setTrack(null); };
      if (deviceId) this.prefs.deviceId = deviceId;
      this._save();
      for (const p of this.peers.values()) p.setTrack(this.micTrack);
      this._mic(this.muted ? 'muted' : 'on');
      return true;
    } catch (e) {
      const n = e && e.name;
      this._mic(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nodevice' : n === 'NotReadableError' || n === 'AbortError' ? 'busy' : 'error');
      return false;
    }
  }

  async devices() {
    try { return (await (this.media || navigator.mediaDevices).enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { return []; }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.micTrack) { this.micTrack.enabled = !this.muted; this._mic(this.muted ? 'muted' : 'on'); }
    this._emit();
  }
  toggleMute() {
    if (!this.micTrack) { this.enableMic(); return; }         // ainda sem microfone: o botao pede a permissao
    this.setMuted(!this.muted);
  }
  setVolume(v) { this.prefs.volume = clamp(+v, 0, 1.6); this._save(); this._emit(); }

  _mic(s) { this.micStatus = s; this._emit(); }
  _save() { try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch { /* ok */ } }
  _emit() { this.onChange?.({ mic: this.micStatus, muted: this.muted, peers: this.peers.size, volume: this.prefs.volume }); }

  // ---------- quem pode falar com quem ----------
  setPlayers(players) {
    for (const p of players) { this.statusOf.set(p.id, p.status); if (p.online !== false) this.online.add(p.id); else this.online.delete(p.id); }
    this.reconcile();
  }
  setStatus(id, status) { this.statusOf.set(id, status); this.reconcile(); }
  setOnline(id, on) { if (on) this.online.add(id); else this.online.delete(id); this.reconcile(); }
  group(id) { const s = this.statusOf.get(id); return s === 'alive' ? 'alive' : s === 'dead' || s === 'escaped' ? 'spirit' : 'none'; }
  allowed(id) { return id !== this.me && this.running && this.group(id) !== 'none' && this.group(id) === this.group(this.me) && this.online.has(id); }

  // abre conexoes que devem existir e FECHA as proibidas (morte de qualquer lado)
  reconcile() {
    if (!this.running) return;
    for (const id of [...this.peers.keys()]) if (!this.allowed(id)) this._close(id);
    for (const [id] of this.statusOf) if (this.allowed(id) && !this.peers.has(id)) this._open(id);
    this._emit();
  }

  async _open(id) {
    const ice = await this._ice();
    if (!this.running || !this.allowed(id) || this.peers.has(id)) return;
    const peer = new VoicePeer(this, id, this.me < id, ice);      // quem tem o menor id inicia (sem colisao de ofertas)
    this.peers.set(id, peer);
    peer.setTrack(this.micTrack);
    if (peer.initiator) peer.negotiate();
  }

  _close(id) { const p = this.peers.get(id); if (!p) return; this.peers.delete(id); p.close(); }

  // mensagem de sinalizacao vinda do servidor
  onSignal(m) {
    if (!this.running || !this.allowed(m.from)) return;        // recusa sinalizacao de quem nao pode falar comigo
    let p = this.peers.get(m.from);
    if (!p) { this._open(m.from).then(() => this.peers.get(m.from)?.handle(m.data)); return; }
    p.handle(m.data);
  }

  // ---------- por quadro ----------
  // listener: THREE.Camera; posOf(id) -> {x,y,z}|null (posicao do avatar do falante)
  update(dt, now, listenerPos, posOf, occludedFn) {
    if (!this.running) return;
    let anySpeaking = false;
    for (const [id, p] of this.peers) {
      if (!p.radio) continue;
      p.radio.measure(now);
      const pos = posOf(id);
      if (pos) {
        const dy = Math.abs(pos.y - listenerPos.y);
        const d = Math.hypot(pos.x - listenerPos.x, pos.z - listenerPos.z) + (dy > 2.5 ? 25 : 0);
        p.radio.set(d, { x: pos.x, y: pos.y + 1.5, z: pos.z }, occludedFn ? occludedFn(pos) : false, this.prefs.volume, now);
      } else p.radio.set(1, { x: listenerPos.x, y: listenerPos.y, z: listenerPos.z - 1 }, false, this.prefs.volume, now);
      if (p.radio.speaking) anySpeaking = true;
    }
    if (anySpeaking) this.audio.duckBeat?.(0.35);            // o coracao nao encobre vozes
  }

  speaking(id) { return !!this.peers.get(id)?.radio?.speaking; }
  connected(id) { return this.peers.get(id)?.state === 'connected'; }
  stateOf(id) { return this.peers.get(id)?.state || 'none'; }
}

class VoicePeer {
  constructor(vc, id, initiator, iceServers) {
    this.vc = vc; this.id = id; this.initiator = initiator; this.state = 'new'; this.pendingIce = []; this.restarts = 0;
    this.pc = new (vc.RTC || RTCPeerConnection)({ iceServers, bundlePolicy: 'max-bundle' });
    this.tr = initiator ? this.pc.addTransceiver('audio', { direction: 'sendrecv' }) : null;
    this.pc.onicecandidate = (e) => { if (e.candidate) vc.signal(id, { ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    this.pc.ontrack = (e) => this._onTrack(e);
    this.pc.onconnectionstatechange = () => this._onState();
    this.closed = false;
  }

  setTrack(track) {
    this.pendingTrack = track;
    const t = this.tr || this.pc.getTransceivers()[0];
    if (t && t.sender) { try { t.sender.replaceTrack(track); } catch { /* ok */ } }
  }

  async negotiate(iceRestart = false) {
    try {
      const offer = await this.pc.createOffer({ iceRestart });
      await this.pc.setLocalDescription(offer);
      this.vc.signal(this.id, { sdp: { type: offer.type, sdp: offer.sdp } });
    } catch { this._fail(); }
  }

  async handle(data) {
    if (this.closed) return;
    try {
      if (data.sdp) {
        await this.pc.setRemoteDescription(data.sdp);
        for (const c of this.pendingIce.splice(0)) { try { await this.pc.addIceCandidate(c); } catch { /* ok */ } }
        if (data.sdp.type === 'offer') {
          if (!this.tr) { this.tr = this.pc.getTransceivers()[0]; if (this.tr) this.tr.direction = 'sendrecv'; if (this.pendingTrack !== undefined) this.setTrack(this.pendingTrack); }
          const ans = await this.pc.createAnswer();
          await this.pc.setLocalDescription(ans);
          this.vc.signal(this.id, { sdp: { type: ans.type, sdp: ans.sdp } });
        }
      } else if (data.ice) {
        if (this.pc.remoteDescription) { try { await this.pc.addIceCandidate(data.ice); } catch { /* candidato antigo */ } } else this.pendingIce.push(data.ice);
      }
    } catch { this._fail(); }
  }

  _onTrack(e) {
    if (this.closed || e.track.kind !== 'audio') return;
    const vc = this.vc, ctx = vc.audio.ctx;
    const stream = e.streams[0] || new MediaStream([e.track]);
    this.stream = stream;
    // Chrome so "puxa" streams remotos do WebRTC se estiverem ligados a um elemento de midia: elemento mudo, o som sai pelo WebAudio
    this.el = document.createElement('audio'); this.el.muted = true; this.el.srcObject = stream; this.el.play?.().catch(() => {});
    if (!vc.bus) vc._ensureBus();
    this.src = ctx.createMediaStreamSource(stream);
    this.radio = new RadioVoice(ctx, this.src, vc.bus, vc.noiseBuf);
    this.radio.set(1, { x: 0, y: 0, z: 0 }, false, vc.prefs.volume, 0);
  }

  _onState() {
    const s = this.pc.connectionState;
    this.state = s;
    if ((s === 'failed' || s === 'disconnected') && this.initiator && this.restarts < 2 && !this.closed) {
      // rede oscilou: nova rodada de ICE sem derrubar a chamada
      this.restarts++; setTimeout(() => { if (!this.closed && this.pc.connectionState !== 'connected') this.negotiate(true); }, s === 'failed' ? 300 : 3000);
    }
    this.vc._emit();
  }
  _fail() { this.state = 'failed'; this.vc._emit(); }

  close() {
    this.closed = true;
    try { this.radio?.dispose(); } catch { /* ok */ }
    try { this.src?.disconnect(); } catch { /* ok */ }
    try { if (this.el) { this.el.srcObject = null; } } catch { /* ok */ }
    try { this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.close(); } catch { /* ok */ }
    this.state = 'closed';
  }
}
