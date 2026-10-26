// Conexao com o servidor multiplayer: acordar (plano gratuito dorme), conectar, reconectar e avisar o estado.
// Estados: idle | waking | connecting | connected | reconnecting | unavailable
import { PROTOCOL_VERSION } from './protocol.js';

const SESSION_KEY = 'apagao.session.v1';

export function readConfig() {
  const c = (typeof window !== 'undefined' && window.APAGAO_CONFIG) || {};
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  let url = params.get('server') || c.serverUrl || '';
  if (!url && typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) url = 'http://localhost:8080';
  url = url.replace(/\/+$/, '');
  const http = url.replace(/^ws(s?):/, 'http$1:');
  const ws = http.replace(/^http/, 'ws') + '/ws';
  return { serverUrl: url, http, ws, configured: !!url, iceServers: Array.isArray(c.iceServers) ? c.iceServers : [] };
}

export class NetClient {
  constructor(cfg = readConfig()) {
    this.cfg = cfg;
    this.state = 'idle';
    this.handlers = new Map();
    this.stateHandlers = new Set();
    this.ws = null;
    this.token = null; this.id = null; this.name = '';
    this.rtt = null; this.attempt = 0; this.wakeStart = 0;
    this.wantOpen = false;          // o jogador quer estar conectado (false apos sair do modo online)
    this._pingT = null; this._retryT = null;
    this.on('pong', (m) => { this.rtt = Math.round(performance.now() - m.ts); });
    try { const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); if (s) { this.token = s.token; this.id = s.id; } } catch { /* sem storage */ }
  }

  on(type, fn) { (this.handlers.get(type) || this.handlers.set(type, new Set()).get(type)).add(fn); return () => this.handlers.get(type).delete(fn); }
  onState(fn) { this.stateHandlers.add(fn); return () => this.stateHandlers.delete(fn); }
  _setState(s, info = {}) { this.state = s; this.info = info; for (const f of this.stateHandlers) f(s, info); }
  _emit(type, m) { const hs = this.handlers.get(type); if (hs) for (const f of hs) f(m); const all = this.handlers.get('*'); if (all) for (const f of all) f(m); }

  get online() { return this.state === 'connected'; }

  // abre a conexao. Primeiro "acorda" o servidor por HTTP (o plano gratuito do Render dorme e leva ~30-60 s), depois abre o WebSocket.
  async connect(name) {
    this.name = name || this.name;
    this.wantOpen = true; this.attempt = 0;
    if (!this.cfg.configured) { this._setState('unavailable', { reason: 'not_configured' }); return false; }
    return this._open(false);
  }

  async _wake(maxMs = 100_000) {
    this.wakeStart = performance.now();
    let delay = 1200, slowNotified = false;
    while (this.wantOpen && performance.now() - this.wakeStart < maxMs) {
      const t0 = performance.now();
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
        const r = await fetch(this.cfg.http + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (r.ok) { const j = await r.json(); if (j.protocol && j.protocol !== PROTOCOL_VERSION) { this._setState('unavailable', { reason: 'version' }); return false; } return true; }
      } catch { /* dormindo ou sem rede: tenta de novo */ }
      const waited = performance.now() - this.wakeStart;
      if (waited > 4000 && !slowNotified) slowNotified = true;
      this._setState('waking', { seconds: Math.round(waited / 1000), slow: slowNotified });
      await new Promise(r => setTimeout(r, Math.max(400, delay - (performance.now() - t0))));
      delay = Math.min(4000, delay * 1.4);
    }
    return false;
  }

  async _open(reconnecting) {
    this._setState(reconnecting ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    if (!reconnecting || this.attempt > 1) {
      const awake = await this._wake(reconnecting ? 70_000 : 100_000);
      if (!this.wantOpen) return false;
      if (!awake) { this._setState('unavailable', { reason: 'no_response' }); return false; }
      this._setState(reconnecting ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    }
    return new Promise((resolve) => {
      let settled = false;
      const ws = new WebSocket(this.cfg.ws);
      this.ws = ws;
      const fail = () => { if (settled) return; settled = true; resolve(false); };
      const timer = setTimeout(() => { try { ws.close(); } catch { /* ok */ } fail(); }, 15000);
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.token })); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.id = m.id; this.token = m.token; this.name = m.name; this.attempt = 0;
          try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: m.token, id: m.id })); } catch { /* ok */ }
          this._setState('connected', {});
          this._startPing();
          if (!settled) { settled = true; resolve(true); }
        }
        this._emit(m.t, m);
      };
      ws.onerror = () => { /* onclose cuida */ };
      ws.onclose = (ev) => {
        clearTimeout(timer); this._stopPing();
        if (this.ws === ws) this.ws = null;
        const wasConnected = this.state === 'connected';
        if (!settled) { settled = true; resolve(false); }
        if (ev.code === 1002 || ev.code === 1008) { this.wantOpen = false; this._setState('unavailable', { reason: ev.code === 1002 ? 'version' : 'rate' }); return; }
        if (!this.wantOpen) { this._setState('idle'); return; }
        if (ev.code === 4000) { this.wantOpen = false; this._setState('idle', { replaced: true }); this._emit('replaced', {}); return; }
        this._emit('dropped', { wasConnected, code: ev.code });
        this._scheduleReconnect();
      };
    });
  }

  // caiu a conexao: tenta voltar ao mesmo personagem (token) com espera crescente; desiste depois de ~1 min
  _scheduleReconnect() {
    if (!this.wantOpen) return;
    this.attempt++;
    if (this.attempt > 9) { this._setState('unavailable', { reason: 'lost' }); this._emit('lost', {}); return; }
    const delay = Math.min(8000, 800 * Math.pow(1.6, this.attempt - 1));
    this._setState('reconnecting', { attempt: this.attempt, inMs: delay });
    clearTimeout(this._retryT);
    this._retryT = setTimeout(() => { if (this.wantOpen) this._open(true); }, delay);
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; } return false; }

  _startPing() {
    this._stopPing();
    const ping = () => this.send({ t: 'ping', ts: performance.now() });
    this._pingT = setInterval(ping, 5000); ping();
  }
  _stopPing() { clearInterval(this._pingT); this._pingT = null; }

  // sair do modo online de vez (voltar ao menu): fecha, esquece a sessao
  disconnect(forget = true) {
    this.wantOpen = false; clearTimeout(this._retryT); this._stopPing();
    try { this.ws?.close(1000, 'bye'); } catch { /* ok */ }
    this.ws = null;
    if (forget) { this.token = null; try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ok */ } }
    this._setState('idle');
  }
}
