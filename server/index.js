// Servidor multiplayer do APAGAO: HTTP (/health, /ice, /rooms) + WebSocket (/ws), salas em memoria.
// Le o PORT do ambiente e escuta em 0.0.0.0. Sem disco, sem banco: se reiniciar, as salas somem (os clientes sao avisados).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadConfig, isOriginAllowed, iceFor } from './config.js';
import { Room } from './room.js';
import { ServerPlayer } from './match.js';
import { AnimData } from '../src/shared/animdata.js';
import { COOP, cleanName, cleanCode } from '../src/shared/coop.js';
import { PROTOCOL_VERSION, ERR } from '../src/net/protocol.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';        // sem I e O (confundem com 1 e 0)

export class Hub {
  constructor(cfg = loadConfig()) {
    this.cfg = cfg;
    this.anim = new AnimData(JSON.parse(readFileSync(new URL('../assets/anim/creature.json', import.meta.url), 'utf8')));
    this.rooms = new Map();
    this.players = new Map();          // token -> ServerPlayer
    this.conns = new Set();
    this.nextId = 1;
    this.startedAt = Date.now();
    this.stopped = false;
    this.server = http.createServer((req, res) => this._http(req, res));
    this.wss = new WebSocketServer({
      server: this.server, path: '/ws', maxPayload: cfg.maxPayload,
      verifyClient: (info, done) => {
        const ok = isOriginAllowed(cfg, info.origin || info.req.headers.origin);
        if (!ok) console.warn(`[ws] origem recusada: ${info.origin || '(sem origem)'}`);
        done(ok, 403, 'origin not allowed');
      },
    });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
  }

  // ---------------- HTTP ----------------
  _cors(req, res) {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(this.cfg, origin)) {
      res.setHeader('Access-Control-Allow-Origin', this.cfg.allowedOrigins.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      return true;
    }
    return !origin;      // sem Origin (health check do provedor, curl): sem cabecalhos CORS, mas atende
  }

  _http(req, res) {
    const url = new URL(req.url, 'http://x');
    const allowed = this._cors(req, res);
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { ok: false });
    if (url.pathname === '/health' || url.pathname === '/') {
      return json(200, { ok: true, name: this.cfg.name, protocol: PROTOCOL_VERSION, uptime: Math.round((Date.now() - this.startedAt) / 1000), rooms: this.rooms.size, players: this.conns.size, maxRooms: this.cfg.maxRooms });
    }
    if (url.pathname === '/rooms') {
      if (!allowed) return json(403, { ok: false, error: 'origin' });
      return json(200, { ok: true, rooms: this.listRooms() });
    }
    if (url.pathname === '/ice') {
      if (!allowed) return json(403, { ok: false, error: 'origin' });
      return json(200, { ok: true, iceServers: iceFor(this.cfg, 'p' + randomBytes(4).toString('hex')) });
    }
    json(404, { ok: false });
  }

  // ---------------- salas ----------------
  listRooms() { return [...this.rooms.values()].map(r => r.listing()); }
  _newCode() {
    for (let i = 0; i < 200; i++) {
      let c = '';
      for (let k = 0; k < COOP.roomCodeLen; k++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }
  createRoom(p, name) {
    if (this.rooms.size >= this.cfg.maxRooms) return { code: ERR.SERVER_FULL, msg: 'Servidor cheio: tente de novo em instantes.' };
    const code = this._newCode();
    if (!code) return { code: ERR.SERVER_FULL, msg: 'Servidor cheio.' };
    const room = new Room(this, code, cleanName(name, 'Sala de ' + p.name));
    this.rooms.set(code, room);
    p.room = room;
    room.join(p);
    console.log(`[sala ${code}] criada por ${p.name} (${this.rooms.size} salas)`);
    return null;
  }
  destroyRoom(room) {
    if (!this.rooms.delete(room.code)) return;
    for (const p of room.members.values()) p.room = null;
    room.match?.dispose(); room.clearAllMimic?.();
    console.log(`[sala ${room.code}] encerrada (${this.rooms.size} salas)`);
  }

  // ---------------- conexoes ----------------
  _onConnection(ws, req) {
    if (this.conns.size >= this.cfg.maxConnections) { ws.close(1013, 'server full'); return; }
    const conn = {
      ws, player: null, alive: true, bucket: { tokens: this.cfg.msgRate.burst, t: Date.now() }, strikes: 0,
      send: (obj) => {
        if (ws.readyState !== 1) return;
        if (obj.t === 'snap' && ws.bufferedAmount > 256 * 1024) return;       // cliente lento: descarta estado velho em vez de acumular
        ws.send(JSON.stringify(obj));
      },
      close: (code = 1000, reason = '') => { try { ws.close(code, reason); } catch { /* ok */ } },
    };
    this.conns.add(conn);
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data, isBinary) => this._onMessage(conn, data, isBinary));
    ws.on('close', () => this._onClose(conn));
    ws.on('error', () => { /* o close cuida */ });
  }

  _onClose(conn) {
    this.conns.delete(conn);
    const p = conn.player;
    if (p && p.conn === conn) { p.conn = null; if (p.room) p.room.disconnect(p); else this._forget(p); }
  }
  _forget(p) { setTimeout(() => { if (!p.room && !p.conn) this.players.delete(p.token); }, 5 * 60_000).unref?.(); }

  _rate(conn) {
    const b = conn.bucket, now = Date.now(), R = this.cfg.msgRate;
    b.tokens = Math.min(R.burst, b.tokens + (now - b.t) / 1000 * R.perSec); b.t = now;
    if (b.tokens < 1) { conn.strikes++; return false; }
    b.tokens -= 1; return true;
  }

  _err(conn, code, msg) { conn.send({ t: 'err', code, msg }); }

  _onMessage(conn, data, isBinary) {
    if (isBinary) return;
    if (!this._rate(conn)) {
      if (conn.strikes > 300) conn.close(1008, 'rate limit');
      return;
    }
    let m;
    try { m = JSON.parse(data.toString()); } catch { return this._err(conn, ERR.BAD_MSG, 'JSON invalido'); }
    if (!m || typeof m.t !== 'string') return this._err(conn, ERR.BAD_MSG, 'mensagem invalida');
    if (m.t === 'hello') return this._hello(conn, m);
    if (m.t === 'ping') return conn.send({ t: 'pong', ts: m.ts, st: Date.now() });
    const p = conn.player;
    if (!p) return this._err(conn, ERR.BAD_MSG, 'envie hello primeiro');
    try { this._dispatch(conn, p, m); } catch (e) { console.error('[erro]', m.t, e); this._err(conn, ERR.BAD_MSG, 'erro interno'); }
  }

  _hello(conn, m) {
    if (m.v !== PROTOCOL_VERSION) return (this._err(conn, ERR.VERSION, 'versao do cliente diferente da do servidor: recarregue a pagina'), conn.close(1002, 'version'));
    let p = m.token ? this.players.get(String(m.token)) : null;
    let resumed = false, expired = false;
    if (p) {
      resumed = true;
      if (p.conn && p.conn !== conn) { p.conn.player = null; p.conn.close(4000, 'replaced'); }
      p.conn = conn;
    } else {
      if (m.token) expired = true;                                  // o cliente tinha uma sessao, o servidor nao a conhece mais (reinicio)
      const id = this.nextId++;
      p = new ServerPlayer(id, cleanName(m.name, 'Sobrevivente ' + id), randomBytes(12).toString('hex'));
      p.room = null; p.ready = false; p.joinedAt = Date.now();
      p.conn = conn; this.players.set(p.token, p);
    }
    conn.player = p;
    conn.send({ t: 'welcome', id: p.id, token: p.token, name: p.name, resumed, expired, room: p.room ? p.room.code : null, protocol: PROTOCOL_VERSION, serverTime: Date.now() });
    if (resumed && p.room) p.room.reconnect(p, conn);
  }

  _dispatch(conn, p, m) {
    const room = p.room, match = room?.match;
    if (!p.conn) p.conn = conn;           // quem saiu de uma partida (removePlayer zera conn) precisa receber de novo ao entrar noutra sala
    switch (m.t) {
      case 'name': { p.name = cleanName(m.name, p.name); room?.pushState(); break; }
      case 'rooms': conn.send({ t: 'rooms', rooms: this.listRooms() }); break;
      case 'create': {
        if (p.room) return this._err(conn, ERR.ALREADY, 'voce ja esta numa sala');
        if (m.name) p.name = cleanName(m.name, p.name);
        const e = this.createRoom(p, m.roomName);
        if (e) this._err(conn, e.code, e.msg);
        break;
      }
      case 'join': {
        if (p.room) return this._err(conn, ERR.ALREADY, 'voce ja esta numa sala');
        if (m.name) p.name = cleanName(m.name, p.name);
        const r = this.rooms.get(cleanCode(m.code));
        if (!r) return this._err(conn, ERR.NO_ROOM, 'Sala nao encontrada.');
        const e = r.join(p);
        if (e === ERR.ROOM_FULL) return this._err(conn, e, 'Sala cheia (' + COOP.maxMembers + '/' + COOP.maxMembers + ').');
        p.room = r;
        break;
      }
      case 'leave': if (room) { room.leave(p); conn.send({ t: 'left_room' }); } break;
      case 'ready': room?.setReady(p, m.on); break;
      case 'start': {
        if (!room) return;
        const e = room.start(p);
        if (e) this._err(conn, e.code || e, e.msg || (e === ERR.NOT_HOST ? 'So o criador da sala inicia.' : 'Nao foi possivel iniciar.'));
        break;
      }
      // ---- partida ----
      case 's': match?.onState(p, m); break;
      case 'take': match?.takeItem(p, m.key); break;
      case 'install': match?.installFuses(p); break;
      case 'door': match?.useDoor(p, m.id, m.open, m.fast); break;
      case 'drawer': match?.useDrawer(p, m.num, m.open); break;
      case 'hide': match?.hide(p, m.spot, !!m.on); break;
      case 'noise': match?.noise(p, m.k); break;
      case 'voice': if (room) this._voice(room, p, m); break;
      case 'mimic': room?.mimicMsg(p, m); break;
      case 'dbg': if (this.cfg.testHooks && match) this._testHook(match, p, m); break;
      default: this._err(conn, ERR.BAD_MSG, 'tipo desconhecido');
    }
  }

  // ganchos so para testes automatizados/manuais (APAGAO_TEST=1); desligados por padrao
  _testHook(match, p, m) {
    if (m.cmd === 'tp') { p.pos.set(+m.x, match.grid.floorY(+m.x, +m.z), +m.z); p.updateEye(); match._correct(p); }
    else if (m.cmd === 'kill') match._kill(p);
    else if (m.cmd === 'wake') match._wakeCreature();
    else if (m.cmd === 'creature') { const ai = match.ai; if (ai.state === 'dormant') match._wakeCreature(); ai.pos.set(+m.x, match.grid.floorY(+m.x, +m.z), +m.z); ai.setState(m.state || 'lurk'); ai.lurkTime = 999; }
    else if (m.cmd === 'grace') { p.offlineAt = -1e9; }
    else if (m.cmd === 'freeze') match.freezeAI = !!m.on;
  }

  // sinalizacao de voz (WebRTC): o servidor so repassa entre quem PODE se falar (regra em Room.canVoice)
  _voice(room, p, m) {
    const to = room.members.get(m.to | 0);
    if (!to || !room.canVoice(p, to)) return;
    if (typeof m.data !== 'object' || m.data === null) return;
    to.conn.send({ t: 'voice', from: p.id, data: m.data });
  }

  // ---------------- relogio ----------------
  start() {
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000); last = now;
      for (const r of [...this.rooms.values()]) { try { r.step(dt); } catch (e) { console.error('[sala ' + r.code + '] erro no tick', e); this.destroyRoom(r); } }
    }, 1000 / COOP.tick);
    this.pinger = setInterval(() => {
      for (const c of this.conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch { /* ok */ } }
    }, 20_000);
    return new Promise((resolve) => this.server.listen(this.cfg.port, this.cfg.host, () => {
      console.log(`[${this.cfg.name}] http/ws em ${this.cfg.host}:${this.server.address().port} (${this.cfg.production ? 'producao' : 'desenvolvimento'}), origens: ${this.cfg.allowedOrigins.join(', ') || '(localhost apenas)'}`);
      if (this.cfg.production && !this.cfg.allowedOrigins.length) console.warn('[apagao] ATENCAO: ALLOWED_ORIGINS esta vazio - nenhum site conseguira conectar. Defina, por ex., ALLOWED_ORIGINS=https://SEU-USUARIO.github.io');
      if (this.cfg.allowedOrigins.includes('*')) console.warn('[apagao] ATENCAO: ALLOWED_ORIGINS=* libera qualquer site. Use so para testes.');
      resolve(this);
    }));
  }

  async stop(reason = 'shutdown') {
    if (this.stopped) return; this.stopped = true;
    clearInterval(this.timer); clearInterval(this.pinger);
    for (const c of this.conns) { c.send({ t: 'bye', reason }); c.close(1001, reason); }
    await new Promise((r) => this.wss.close(() => r()));
    await new Promise((r) => this.server.close(() => r()));
  }
}

// execucao direta: node server/index.js
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hub = new Hub();
  await hub.start();
  const bye = (sig) => { console.log(`[${sig}] encerrando...`); hub.stop('restart').then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', () => bye('SIGTERM'));
  process.on('SIGINT', () => bye('SIGINT'));
}
