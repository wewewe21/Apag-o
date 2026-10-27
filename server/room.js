// Sala do cooperativo: lobby (nomes, prontos, criador) e, ao iniciar, uma Match autoritativa.
// Estado das salas fica so em memoria: se o servidor reiniciar, a partida termina (os clientes sao avisados), nunca "finge" recuperar.
import { COOP, MIMIC, cleanName } from '../src/shared/coop.js';
import { ERR, PHASE, RESULT } from '../src/net/protocol.js';
import { Match } from './match.js';

const LOBBY_GRACE_MS = 30_000;

export class Room {
  constructor(hub, code, name) {
    this.hub = hub;
    this.code = code; this.name = name;
    this.phase = PHASE.LOBBY;
    this.members = new Map();            // id -> ServerPlayer (com .ready, .joinedAt)
    this.hostId = null;
    this.match = null;
    this.lastResult = null;
    this.createdAt = Date.now();
    this.acc = 0;
    this.seq = 0;                        // contador de chegada: define a fila dos espectadores
  }

  get count() { return this.members.size; }
  get full() { return this.members.size >= COOP.maxMembers; }
  hostName() { return this.members.get(this.hostId)?.name ?? '-'; }
  // Papeis: ate COOP.maxPlayers JOGAM; os demais (ate COOP.maxMembers no total) so assistem como espirito e formam a fila.
  playersList() { return [...this.members.values()].filter(m => m.role === 'player'); }
  queue() { return [...this.members.values()].filter(m => m.role === 'spectator').sort((a, b) => a.queueN - b.queueN); }
  listing() {
    const players = this.playersList().length;
    return { code: this.code, name: this.name, host: this.hostName(), count: this.count, max: COOP.maxMembers, players, maxPlayers: COOP.maxPlayers, spectators: this.count - players, phase: this.phase };
  }

  // ---------- envio ----------
  send(p, obj) { p.conn?.send(obj); }
  broadcast(obj, filter) { for (const p of this.members.values()) if (p.conn && (!filter || filter(p))) p.conn.send(obj); }
  roomState(forId = null) {
    const queue = this.queue();
    return {
      t: 'room', code: this.code, name: this.name, phase: this.phase, host: this.hostId, max: COOP.maxMembers, maxPlayers: COOP.maxPlayers, you: forId,
      members: [...this.members.values()].map(p => ({
        id: p.id, name: p.name, ready: !!p.ready, online: p.connected, status: this.match ? p.status : 'lobby',
        role: p.role, q: p.role === 'spectator' ? queue.indexOf(p) + 1 : 0, watcher: !!p.watcher,
      })),
      result: this.lastResult,
    };
  }
  pushState() { for (const p of this.members.values()) if (p.conn) p.conn.send(this.roomState(p.id)); }

  // ---------- entrada e saida ----------
  // Entra sempre que houver lugar (ate 10). No lobby, os 4 primeiros jogam e os outros entram na fila como espectadores;
  // com a partida em andamento TODOS entram como espectador (espirito) e esperam a proxima rodada.
  join(p) {
    if (this.full) return ERR.ROOM_FULL;
    p.ready = false; p.joinedAt = Date.now(); p.offlineWall = null; p.queueN = ++this.seq; p.status = 'alive'; p.watcher = false;
    const dup = [...this.members.values()].filter(q => q.name === p.name).length;       // nome repetido na sala: acrescenta numero
    if (dup) p.name = cleanName(p.name + ' ' + (dup + 1), p.name);
    p.role = this.phase === PHASE.LOBBY && this.playersList().length < COOP.maxPlayers ? 'player' : 'spectator';
    this.members.set(p.id, p);
    if (this.hostId == null) this.hostId = p.id;
    if (this.match) this.match.addWatcher(p);
    this.pushState();
    this.sendMimicTo(p);
    if (this.match) {
      this.send(p, { t: 'start', total: COOP.fusesTotal, players: [...this.match.players.values()].map(q => ({ id: q.id, name: q.name })) });
      this.send(p, this.match.fullSync(p));
    }
    return null;
  }

  // vagas de jogador livres (alguem saiu): preenche NA ORDEM DA FILA, so com quem esta conectado
  _fillSlots() {
    let free = COOP.maxPlayers - this.playersList().length;
    const promoted = [];
    for (const q of this.queue()) {
      if (free <= 0) break;
      if (!q.connected) continue;
      q.role = 'player'; q.ready = false; free--; promoted.push(q);
    }
    for (const q of promoted) this.send(q, { t: 'role', role: 'player' });
    return promoted;
  }

  leave(p) {
    if (!this.members.has(p.id)) return;
    if (this.match && p.status !== 'left') this.match.removePlayer(p, 'left');
    this.clearMimic(p);
    this.members.delete(p.id);
    p.room = null;
    if (this.hostId === p.id) this._newHost();
    if (!this.match) this._fillSlots();         // no lobby a vaga vai para o primeiro da fila (durante a partida, so na proxima rodada)
    this.pushState();
    if (!this.members.size) this.hub.destroyRoom(this);
  }

  // criador saiu: passa o controle do lobby para o mais antigo que continua conectado, de preferencia um JOGADOR (a partida segue rodando)
  _newHost() {
    const byAge = (a, b) => a.joinedAt - b.joinedAt;
    const all = [...this.members.values()];
    const next = all.filter(m => m.role === 'player' && m.connected && m.status !== 'left').sort(byAge)[0]
      || all.filter(m => m.connected && m.status !== 'left').sort(byAge)[0]
      || all.sort(byAge)[0];
    this.hostId = next ? next.id : null;
    if (next) this.broadcast({ t: 'host', id: next.id, name: next.name });
  }

  disconnect(p) {
    p.conn = null; p.offlineWall = Date.now();
    if (this.match) this.match.onDisconnect(p);
    if (this.hostId === p.id) this._newHost();
    this.pushState();
  }

  reconnect(p, conn) {
    p.conn = conn; p.offlineWall = null;
    if (this.match) this.match.onReconnect(p, conn);
    if (this.hostId == null || !this.members.get(this.hostId)?.connected) this.hostId = p.id;
    p.conn.send(this.roomState(p.id));
    if (this.match) p.conn.send(this.match.fullSync(p));
    this.sendMimicTo(p);
    this.pushState();
  }

  setReady(p, on) { if (this.phase !== PHASE.LOBBY) return; p.ready = !!on; this.pushState(); }

  // ---------- partida ----------
  start(p) {
    if (p.id !== this.hostId) return ERR.NOT_HOST;
    if (this.phase !== PHASE.LOBBY) return ERR.ROOM_STARTED;
    const online = this.playersList().filter(m => m.connected);
    const waiting = online.filter(m => m.id !== this.hostId && !m.ready).map(m => m.name);       // espectadores nao precisam ficar prontos
    if (waiting.length) return { code: ERR.NOT_READY, msg: 'Aguardando: ' + waiting.join(', ') };
    // quem esta offline no lobby nao entra na partida; a vaga vai para a fila
    for (const m of [...this.members.values()]) if (!m.connected) this.members.delete(m.id);
    this._fillSlots();
    const players = this.playersList(), watchers = this.queue();
    if (!players.length) return { code: ERR.NOT_READY, msg: 'Nenhum jogador na sala.' };
    this.phase = PHASE.PLAYING; this.lastResult = null;
    for (const m of players) { m.status = 'alive'; m.ready = false; m.offlineAt = null; m.watcher = false; }
    this.match = new Match(this, players, this.hub.anim);
    for (const w of watchers) { w.ready = false; w.offlineAt = null; this.match.addWatcher(w); }       // espectadores: espirito desde o primeiro segundo
    this.pushState();
    const all = [...players, ...watchers];
    for (const m of all) this.send(m, { t: 'start', total: COOP.fusesTotal, players: all.map(q => ({ id: q.id, name: q.name })) });
    for (const m of all) this.send(m, this.match.fullSync(m));
    return null;
  }

  onEnd(result, stats) {
    // a partida chamou o fim de dentro do proprio tick: fecha no proximo ciclo
    setImmediate(() => this._finish(result, stats));
  }

  _finish(result, stats) {
    if (!this.match) return;
    const match = this.match;
    this.lastResult = { result, stats, at: Date.now() };
    this.broadcast({ t: 'end', result, stats, players: [...this.members.values()].map(p => ({ id: p.id, name: p.name, status: p.status, watcher: !!p.watcher })) });
    this.clearAllMimic();                      // amostras e falas de voz: so valem durante a partida
    match.dispose(); this.match = null;
    this.phase = PHASE.LOBBY;
    for (const m of [...this.members.values()]) {
      if (m.status === 'left') { this.members.delete(m.id); m.room = null; continue; }
      m.ready = false; m.status = 'alive'; m.watcher = false; m.hidden = null; m.carry.clear(); m.hasKey = false; m.dying = false; m.fl.on = false; m.holding = false;
    }
    this._fillSlots();                         // vagas de quem saiu na partida: primeiros da fila (quem ja jogava continua jogando)
    if (this.hostId == null || !this.members.has(this.hostId) || this.members.get(this.hostId).role !== 'player') this._newHost();
    this.pushState();
    if (!this.members.size) this.hub.destroyRoom(this);
  }

  // ---------- relogio ----------
  step(dt) {
    if (this.match) {
      // passo fixo de 50 ms (a IA foi ajustada para isso); se o servidor atrasar, descarta o excesso em vez de acumular
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / COOP.tick && n < 4) { this.match.tick(1 / COOP.tick); this.acc -= 1 / COOP.tick; n++; }
      if (this.acc > 0.5) this.acc = 0;
    }
    const now = Date.now();
    for (const p of [...this.members.values()]) {
      if (p.offlineWall && !this.match && now - p.offlineWall > LOBBY_GRACE_MS) this.leave(p);
    }
    // ninguem online e nenhuma partida em andamento: sala abandonada
    if (!this.match && ![...this.members.values()].some(m => m.connected)) this.hub.destroyRoom(this);
  }

  // ---------- eco de voz (a criatura imitando um jogador que autorizou) ----------
  // Guarda so na memoria: clipes curtos ja GERADOS pelo navegador do dono (nunca a gravacao). Descarta ao fim da partida,
  // quando o dono sai/revoga ou quando a sala fecha.
  mimicMsg(p, m) {
    if (p.role !== 'player') return;                // espectador nao cede a voz para a criatura
    if (m.op === 'on') { p.mimic = { clips: new Map(), chars: 0 }; this.broadcast({ t: 'mimic', op: 'on', from: p.id }, (q) => q !== p); return; }
    if (m.op === 'off') { this.clearMimic(p); return; }
    if (m.op !== 'clip' || !p.mimic) return;
    const i = m.i | 0, data = m.data;
    if (i < 0 || i >= MIMIC.phrases.length || !MIMIC.sampleRates.includes(m.sr | 0)) return;
    if (typeof data !== 'string' || data.length > MIMIC.maxClipChars || !/^[A-Za-z0-9+/=]+$/.test(data)) return;
    const old = p.mimic.clips.get(i);
    const chars = p.mimic.chars - (old ? old.data.length : 0) + data.length;
    if (chars > MIMIC.maxTotalChars || (!old && p.mimic.clips.size >= MIMIC.maxClips)) return;
    p.mimic.clips.set(i, { sr: m.sr | 0, data }); p.mimic.chars = chars;
    this.broadcast({ t: 'mimic', op: 'clip', from: p.id, i, sr: m.sr | 0, data }, (q) => q !== p);
  }
  clearMimic(p) {
    if (!p.mimic) return;
    p.mimic = null;
    this.broadcast({ t: 'mimic', op: 'gone', from: p.id });
  }
  clearAllMimic() { for (const p of this.members.values()) this.clearMimic(p); }
  // envia a quem entrou/reconectou os clipes que os outros ja cederam
  sendMimicTo(q) {
    for (const p of this.members.values()) {
      if (!p.mimic) continue;                       // (inclui o proprio q: apos recarregar a pagina ele precisa ouvir a propria voz e poder revogar)
      q.conn?.send({ t: 'mimic', op: 'on', from: p.id });
      for (const [i, c] of p.mimic.clips) q.conn?.send({ t: 'mimic', op: 'clip', from: p.id, i, sr: c.sr, data: c.data });
    }
  }
  // quem pode ser imitado agora: autorizou e mandou todas as frases
  mimicVoices() { return [...this.members.values()].filter(p => p.mimic && p.mimic.clips.size >= MIMIC.maxClips); }

  // ---------- voz ----------
  // Quem pode falar com quem: no lobby todos; na partida so vivos com vivos ou espiritos/escapados entre si.
  // Morto nunca fala com vivo (nem apos reconectar: o estado esta no servidor).
  voiceGroup(p) {
    if (!this.match) return 'lobby';
    return p.status === 'alive' ? 'alive' : p.status === 'left' ? 'none' : 'spirit';
  }
  canVoice(a, b) {
    if (a === b || !a.connected || !b.connected) return false;
    const ga = this.voiceGroup(a), gb = this.voiceGroup(b);
    return ga !== 'none' && ga === gb;
  }
}
