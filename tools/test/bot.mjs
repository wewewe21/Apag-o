// Cliente "robo" para testar o servidor sem navegador: fala o mesmo protocolo do jogo pelo WebSocket.
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../src/net/protocol.js';

export class Bot {
  constructor(url, name, opts = {}) {
    this.url = url; this.name = name; this.opts = opts;
    this.msgs = []; this.waiters = []; this.token = opts.token ?? null;
    this.id = null; this.room = null; this.sync = null; this.snap = null; this.closed = false; this.closeInfo = null;
    this.pos = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }; this.items = new Map(); this.dead = false; this.status = 'alive';
    this.state = { crouch: 0, mv: 0, fl: [0, 0], hb: 0 };
  }

  connect() {
    return new Promise((resolve, reject) => {
      const headers = this.opts.origin ? { Origin: this.opts.origin } : {};
      const ws = this.ws = new WebSocket(this.url, { headers });
      ws.on('open', () => { this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.token }); });
      ws.on('message', (d) => this._on(JSON.parse(d.toString()), resolve));
      ws.on('close', (code, reason) => { this.closed = true; this.closeInfo = { code, reason: reason.toString() }; this._flush(); if (!this.welcome) reject(new Error('fechou antes do welcome: ' + code)); });
      ws.on('error', (e) => { if (!this.welcome) reject(e); });
      ws.on('unexpected-response', (req, res) => { this.closeInfo = { code: res.statusCode }; this.closed = true; reject(new Error('HTTP ' + res.statusCode)); });
    });
  }

  _on(m, resolveConnect) {
    this.msgs.push(m);
    if (m.t === 'welcome') { this.welcome = m; this.id = m.id; this.token = m.token; resolveConnect?.(m); }
    else if (m.t === 'room') { this.room = m; }
    else if (m.t === 'sync') { this.sync = m; this.status = m.status; this.items = new Map(m.items.map(i => [i.key, { ...i }])); this.pos = { ...this.pos, ...m.pose }; }
    else if (m.t === 'snap') this.snap = m;
    else if (m.t === 'item') { const it = this.items.get(m.key) || { key: m.key }; Object.assign(it, { st: m.st, by: m.by }); if (m.x != null) Object.assign(it, { x: m.x, y: m.y, z: m.z }); this.items.set(m.key, it); }
    else if (m.t === 'dead' && m.id === this.id) { this.dead = true; this.status = 'dead'; }
    else if (m.t === 'corr') { this.pos.x = m.x; this.pos.y = m.y; this.pos.z = m.z; }
    else if (m.t === 'dead') { for (const d of m.drops || []) { const it = this.items.get(d.key); if (it) Object.assign(it, { st: 'world', by: null, x: d.x, y: d.y, z: d.z }); } }
    this._flush();
  }
  _flush() {
    this.waiters = this.waiters.filter((w) => {
      const i = this.msgs.findIndex(w.pred);
      if (i >= 0) { const [m] = this.msgs.splice(i, 1); clearTimeout(w.timer); w.resolve(m); return false; }
      if (this.closed) { clearTimeout(w.timer); w.reject(new Error('conexao fechada esperando ' + w.label)); return false; }
      return true;
    });
  }

  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  // espera (e consome) a proxima mensagem que casa; tipo string ou funcao
  next(pred, timeout = 3000) {
    const label = typeof pred === 'string' ? pred : 'predicado';
    const p = typeof pred === 'string' ? (m) => m.t === pred : pred;
    return new Promise((resolve, reject) => {
      const i = this.msgs.findIndex(p);
      if (i >= 0) { const [m] = this.msgs.splice(i, 1); return resolve(m); }
      const w = { pred: p, resolve, reject, label, timer: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(new Error(`timeout esperando ${label}`)); }, timeout) };
      this.waiters.push(w);
    });
  }
  // devolve todas as mensagens ja recebidas que casam (sem consumir)
  peek(pred) { const p = typeof pred === 'string' ? (m) => m.t === pred : pred; return this.msgs.filter(p); }
  drop(pred) { const p = typeof pred === 'string' ? (m) => m.t === pred : pred; this.msgs = this.msgs.filter(m => !p(m)); }
  async tryNext(pred, timeout = 400) { try { return await this.next(pred, timeout); } catch { return null; } }

  // posicao/estado continuo, como o cliente real
  sendState(over = {}) {
    Object.assign(this.pos, over.pos || {});
    this.send({ t: 's', x: this.pos.x, y: this.pos.y, z: this.pos.z, yw: this.pos.yaw, pt: this.pos.pitch, cr: this.state.crouch, mv: this.state.mv, fl: this.state.fl, hb: this.state.hb, ...over.msg });
  }
  close() { try { this.ws.close(); } catch { /* ok */ } }
  terminate() { try { this.ws.terminate(); } catch { /* ok */ } }
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
