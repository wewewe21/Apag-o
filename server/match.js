// Partida cooperativa autoritativa (uma por sala). O servidor guarda o estado OFICIAL de tudo que altera a partida:
// itens/fusiveis, quadro de energia, portas, armarios, mortes, saida e a criatura (uma so por sala).
// Os clientes mandam intencoes (pegar, instalar, abrir...) e o servidor valida distancia, posse e estado antes de aplicar.
import * as THREE from 'three';
import * as CFG from '../src/config.js';
import { NOISE, PLAYER, FLASHLIGHT as F, HOLD_BREATH, CELL } from '../src/config.js';
import { COOP, MIMIC, directorFuses } from '../src/shared/coop.js';
import { pickFuseLayout, fuseItemDef } from '../src/shared/fusespots.js';
import { CreatureAI } from '../src/entities/creatureAI.js';
import { Director } from '../src/entities/director.js';
import { HeadlessCreatureModel } from './headless-model.js';
import { HeadlessWorld } from './headless.js';
import { FLAG, MOVE, CREATURE_STATES, CREATURE_SUBS, CLIPS, RESULT, REASON } from '../src/net/protocol.js';
import { clamp, lerp } from '../src/core/rng.js';

const R2 = (v) => Math.round(v * 100) / 100;
const R3 = (v) => Math.round(v * 1000) / 1000;
const V = () => new THREE.Vector3();

// -------- lanterna do jogador vista pelo servidor (feixe reconstruido da posicao/olhar informados) --------
class ServerFlashlight {
  constructor(p) { this.p = p; this.on = false; this.focus = 0; this._pos = V(); this._dir = V(); this._tmp = V(); }
  beam() {
    const p = this.p, cp = Math.cos(p.pitch), sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    this._dir.set(-sy * cp, Math.sin(p.pitch), -cy * cp);
    // maozinha: um pouco a direita e abaixo dos olhos, como no cliente
    this._pos.set(p.eye.x + cy * 0.16 + sy * 0.05, p.eye.y - 0.2, p.eye.z - sy * 0.16 + cy * 0.05);
    const f = this.focus;
    return { pos: this._pos, dir: this._dir, angle: lerp(F.angle, F.focusAngle, f), range: lerp(F.distance, F.focusDistance, f), on: this.on && !p.hidden, focus: f };
  }
  illum(pt, rangeOverride) {
    const b = this.beam();
    if (!b.on) return 0;
    const v = this._tmp.copy(pt).sub(b.pos);
    const d = v.length(), range = rangeOverride ?? b.range;
    if (d > range) return 0;
    const c = v.normalize().dot(b.dir), cosA = Math.cos(b.angle);
    if (c < cosA) return 0;
    return clamp((c - cosA) / (1 - cosA) * 2.5, 0, 1) * (1 - d / range);
  }
}

// -------- jogador no servidor --------
export class ServerPlayer {
  constructor(id, name, token) {
    this.id = id; this.name = name; this.token = token;
    this.conn = null;                       // { send(obj) } ou null se desconectado
    this.status = 'alive';                  // alive | dead | escaped | left
    this.dying = false;                     // pego pela criatura, animacao de morte em curso
    this.offlineAt = null;                  // instante em que caiu a conexao (janela de reconexao)
    this.pos = V(); this.eye = V(); this.yaw = Math.PI; this.pitch = 0;
    this.crouch = 0; this.mv = MOVE.IDLE; this.sprinting = false;
    this.holding = false; this.breath = 1; this.gasped = false;
    this.hidden = null;
    this.fl = new ServerFlashlight(this);
    this.carry = new Set(); this.hasKey = false;
    this.lastMoveT = 0; this.stepAcc = 0; this.lastState = 0;
    this.ghostT = 0; this.diedAt = null;
    this.corrections = 0; this.rate = { t: 0, n: 0 };
    this.view = null;
    this.role = 'player';                   // player | spectator (so assiste; vira jogador pela fila na proxima rodada)
    this.watcher = false;                   // true enquanto esta partida o trata como espectador (nunca jogou esta rodada)
    this.queueN = 0;                        // ordem de chegada na sala: define a fila dos espectadores
  }
  get alive() { return this.status === 'alive'; }
  get connected() { return !!this.conn; }
  updateEye() {
    if (this.hidden) this.eye.copy(this.hidden.camPos);
    else this.eye.set(this.pos.x, this.pos.y + lerp(PLAYER.eyeStand, PLAYER.eyeCrouch, this.crouch), this.pos.z);
  }
}

// visao que a IA enxerga (getters sobre o estado do jogador)
class PlayerView {
  constructor(p) { this.p = p; this.fl = p.fl; }
  get id() { return this.p.id; }
  get pos() { return this.p.pos; }
  get eye() { return this.p.eye; }
  get hidden() { return this.p.hidden; }
  get holdingBreath() { return this.p.holding && !this.p.gasped; }
  get crouch() { return this.p.crouch; }
  get sprinting() { return this.p.sprinting; }
  get dead() { return this.p.status !== 'alive'; }
}

const ORDER = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export class Match {
  // room: { broadcast(obj, filter?), send(p, obj), onEnd(result) }; players: [ServerPlayer]; anim: AnimData
  constructor(room, players, anim, opts = {}) {
    this.room = room;
    this.opts = opts;
    this.cfg = CFG;
    this.world = new HeadlessWorld();
    const w = this.world;
    this.grid = w.grid; this.lighting = w.lighting;
    this.time = 0; this.tickN = 0;
    this.state = 'playing'; this.multi = true; this.freezeAI = false;
    this.stats = { repels: 0, deaths: 0 };
    this.debug = null; this.hud = null;
    this.events = [];
    this.players = new Map();
    this.views = [];
    this.result = null;
    this.phase = 'playing';                  // playing | finale | ended
    this.installed = [];                     // ids de fusiveis instalados, em ordem
    this.exitOpen = false;
    this.startedAt = Date.now();
    this.mimicT = MIMIC.interval[0] + Math.random() * (MIMIC.interval[1] - MIMIC.interval[0]); this.lastMimic = -99;
    this._nextGhostBase = () => COOP.ghost.min + Math.random() * (COOP.ghost.max - COOP.ghost.min);

    // criatura e diretor (uma por sala)
    this.ai = new CreatureAI(this, new HeadlessCreatureModel(anim));
    this.director = new Director(this);
    this.audio = this._audioProxy();
    this.fx = { smokeBurst: (p) => this.emit('smoke', [R2(p.x), R2(p.y), R2(p.z)]) };

    // itens. Os FUSIVEIS sao sorteados a cada partida (pontos de spec.fuseSpots + uma gaveta); pilhas e chave sao fixas.
    this.fuseLayout = null;
    this.itemDefs = w.itemDefs;
    if (w.fuseSpots?.length && !opts.fixedFuses) {
      const rng = opts.fuseRng || Math.random;
      const ids = Array.from({ length: COOP.fusesTotal }, (_, i) => i + 1);
      this.fuseLayout = pickFuseLayout(w.fuseSpots, w.drawers.map(d => ({ num: d.num, x: d.x, y: d.y, z: d.z + 0.2 })), ids, rng);
      this.itemDefs = [...w.itemDefs.filter(d => d.type !== 'fuse'), ...this.fuseLayout.map(fuseItemDef)];
    }
    this.items = new Map();
    for (const d of this.itemDefs) this.items.set(d.key, { key: d.key, type: d.type, id: d.id, def: d, drawer: d.drawer ?? null, state: 'world', by: null, pos: { x: d.x, y: d.y, z: d.z } });
    this.drawerOpen = new Map(w.drawers.map(d => [d.num, false]));
    this.meet = { x: w.panel.x, z: w.panel.z - COOP.meeting.forward };

    // jogadores: todos na mesma regiao, sem sobreposicao
    let i = 0;
    for (const p of players) { this._spawn(p, i++); this.players.set(p.id, p); p.view = new PlayerView(p); this.views.push(p.view); }
    this.world.lighting.setPowered([]);
    for (const d of w.doors) d.sent = this._doorKey(d);       // estado inicial ja e conhecido pelos clientes
  }

  _doorKey(d) { return (d.target > 0.5 ? 1 : 0) + '|' + d.dir + '|' + d.locked + '|' + d.jammed; }

  // ---------------- utilidades ----------------
  emit(kind, ...args) { this.events.push([kind, ...args]); }
  aliveList() { return [...this.players.values()].filter(p => p.status === 'alive'); }
  targets() { return this.views; }
  nameOf(id) { return this.players.get(id)?.name ?? '?'; }

  _spawn(p, index) {
    const w = this.world, g = this.grid, s = w.playerStart;
    const taken = [...this.players.values()].map(q => q.pos);
    const [ox, oz] = ORDER[index % 4];
    let best = null;
    for (let k = 0; k < 8 && !best; k++) {
      const f = 0.6 * (1 + k * 0.5);
      const c = w.freeSpotNear(s.x + ox * f, s.z + oz * f, 0, 1.5);
      if (c && taken.every(q => Math.hypot(q.x - c.x, q.z - c.z) >= COOP.spawnSpacing)) best = c;
    }
    best = best || { x: s.x, z: s.z, y: g.floorY(s.x, s.z) };
    p.pos.set(best.x, best.y, best.z); p.yaw = s.yaw; p.pitch = 0; p.crouch = 0;
    p.status = 'alive'; p.dying = false; p.hidden = null; p.holding = false; p.breath = 1; p.gasped = false;
    p.carry.clear(); p.hasKey = false; p.diedAt = null; p.offlineAt = null; p.lastState = 0; p.budget = 2;
    p.updateEye();
  }

  spawnPose(p) { return { x: R3(p.pos.x), y: R3(p.pos.y), z: R3(p.pos.z), yaw: p.yaw }; }

  // Espectador: entra na partida (no inicio ou com ela em andamento) ja como ESPIRITO. Nao conta como jogador (nao pode pegar
  // nada, a criatura o ignora, nao assombra os vivos) e fala so com outros espiritos. Na proxima rodada a fila decide quem joga.
  addWatcher(p) {
    const had = this.players.has(p.id);              // quem saiu e voltou na mesma partida: continua registrado, mas agora como espectador
    this._spawn(p, this.players.size);
    p.watcher = true; p.status = 'dead'; p.diedAt = this.time; p.ghostT = Infinity; p.dying = false;
    if (!had) { this.players.set(p.id, p); p.view = new PlayerView(p); this.views.push(p.view); }
  }

  // ---------------- host da IA da criatura ----------------
  _audioProxy() {
    const emit = (k, ...a) => this.emit(k, ...a);
    const P = (p) => [R2(p.x), R2(p.y ?? 0), R2(p.z)];
    return {
      creatureCry: (pos, kind) => emit('cry', P(pos), kind),
      sizzle: (on, pos) => emit('sizzle', on ? 1 : 0, pos ? P(pos) : null),
      ventRattle: (pos) => emit('vrat', P(pos)),
      doorRattle: (pos) => emit('drat', P(pos)),
      doorSlam: (pos) => emit('slam', P(pos)),
      ventTravel: (from, to, dur) => emit('vtrav', [R2(from.x), R2(from.base), R2(from.z)], [R2(to.x), R2(to.base), R2(to.z)], R2(dur)),
      lockerBang: (pos) => emit('lbang', P(pos)),
      creatureSteps: () => {},
    };
  }

  makeNoise(x, z, radius, kind, fromCreature = false) {
    if (fromCreature || radius <= 0 || this.phase === 'ended') return;
    this.ai.hear(x, z, radius, kind);
  }

  burstLamp(lamp) {
    lamp.state = 'dead';
    this.lighting.computeLightMap();
    this.emit('lamp', lamp.id);
    this.audio.creatureCry(this.ai.pos, 'hiss');
  }

  forceUnhide(spot, occ) { if (occ) this._unhide(occ.p ?? occ, true); else if (spot) spot.occupant = null; }

  onCaught(ai, fromHide, view) {
    const victim = view && (view.p ?? view);
    if (!victim) return;
    victim.dying = true;
    this.room.send(victim, { t: 'caught', hidden: !!fromHide });
    this.emit('caught', victim.id);
  }

  onBurnProgress(view, v) {
    const p = view && view.p;
    if (!p) return;
    if (Math.abs((p._burnSent ?? -1) - v) > 0.04 || (v === 0 && p._burnSent !== 0)) { p._burnSent = v; this.room.send(p, { t: 'burn', v: R2(v) }); }
  }

  playerDies(view) { if (view) this._kill(view.p ?? view); }

  _wakeCreature() {
    const spawn = this.world.creatureSpawn;
    this.ai.activate(spawn);
    this.emit('wake', [spawn.x, 1, spawn.z]);
  }

  // ---------------- entrada dos clientes ----------------
  // estado continuo (15 Hz): posicao, olhar, agachar, lanterna...
  onState(p, m) {
    if (p.status === 'left') return;
    const now = this.time;
    const dt = Math.min(0.5, now - (p.lastState || now - 0.066));
    p.lastState = now;
    p.budget = Math.min(2.5, (p.budget ?? 2) + COOP.maxSpeed * Math.max(0, dt));      // metros que ele pode andar agora
    p.yaw = Number.isFinite(m.yw) ? m.yw : p.yaw;
    p.pitch = clamp(Number.isFinite(m.pt) ? m.pt : p.pitch, -1.5, 1.5);
    const fl = m.fl || [0, 0];
    p.fl.on = !!fl[0]; p.fl.focus = clamp(+fl[1] || 0, 0, 1);
    p.holding = !!m.hb;
    if (p.dying) return;
    if (p.status === 'alive') this._aliveState(p, m, dt);
    else this._ghostState(p, m, dt);
  }

  _aliveState(p, m, dt) {
    const g = this.grid;
    if (p.hidden) { p.mv = MOVE.IDLE; p.sprinting = false; p.updateEye(); return; }   // escondido: a posicao e a do esconderijo
    const nx = +m.x, ny = +m.y, nz = +m.z;
    if (![nx, ny, nz].every(Number.isFinite)) return;
    const dist = Math.hypot(nx - p.pos.x, nz - p.pos.z);
    if (dist > p.budget + 0.4) { this._correct(p); return; }                         // rapido demais / teleporte: volta ao ultimo lugar valido
    p.budget = Math.max(0, p.budget - dist);
    let [qx, qz] = g.collideCircle(nx, nz, PLAYER.radius);
    if (Math.hypot(qx - nx, qz - nz) > 0.5) { this._correct(p); return; }           // dentro de parede
    const moved = Math.hypot(qx - p.pos.x, qz - p.pos.z);
    const y = g.floorY(qx, qz);
    if (Math.abs(y - ny) > 1.2) { this._correct(p); return; }
    p.pos.set(qx, y, qz);
    p.crouch = clamp(+m.cr || 0, 0, 1);
    p.mv = m.mv | 0; p.sprinting = p.mv === MOVE.SPRINT;
    p.updateEye();
    // passos: mesmo criterio do cliente (passada maior correndo) e mesmo raio de ruido
    if (p.mv !== MOVE.IDLE && moved > 0.002) {
      p.stepAcc += moved;
      const stride = p.sprinting ? 1.05 : lerp(0.78, 0.6, p.crouch);
      if (p.stepAcc >= stride) {
        p.stepAcc = 0;
        const zone = g.zoneCfg(g.cellX(p.pos.x), g.cellY(p.pos.z));
        let r = p.sprinting ? NOISE.sprint : p.crouch > 0.5 ? NOISE.crouch : NOISE.walk;
        if (zone?.water) r = Math.max(r, p.crouch > 0.5 ? NOISE.water * 0.45 : NOISE.water);
        this.makeNoise(p.pos.x, p.pos.z, r, 'passos');
      }
    }
    this._checkExit(p);
  }

  _correct(p) {
    p.corrections++;
    this.room.send(p, { t: 'corr', x: R3(p.pos.x), y: R3(p.pos.y), z: R3(p.pos.z) });
  }

  // espirito/escapado: anda livre e atravessa paredes e moveis, mas nunca sai do predio (barreira externa, ver Grid.ghostMove)
  _ghostState(p, m, dt) {
    const g = this.grid;
    const nx = +m.x, nz = +m.z;
    if (![nx, nz].every(Number.isFinite)) return;
    if (Math.hypot(nx - p.pos.x, nz - p.pos.z) > p.budget * 1.6 + 0.6) { this._correct(p); return; }
    p.budget = Math.max(0, p.budget - Math.hypot(nx - p.pos.x, nz - p.pos.z));
    if (!g.ghostWalkable(nx, nz)) { this._correct(p); return; }
    p.pos.set(nx, g.floorY(nx, nz), nz);
    p.mv = m.mv | 0; p.updateEye();
  }

  // ---------------- acoes validadas ----------------
  _deny(p, act, reason, extra = {}) { this.room.send(p, { t: 'deny', act, reason, ...extra }); return false; }
  _near(p, x, z, r, y = null) {
    if (Math.hypot(p.pos.x - x, p.pos.z - z) > r) return false;
    if (y != null && Math.abs(p.pos.y - y) > 2.6) return false;
    return true;
  }
  // o jogador consegue ENXERGAR o ponto (paredes e portas fechadas bloqueiam; moveis e o proprio painel/gaveta nao)?
  _los(p, x, z, door = null) {
    return this.grid.segmentClear(p.eye.x, p.eye.z, x, z, true, (b) => b.prop || b.kind === 'drawers' || (door && b.door === door));
  }
  _canAct(p, act) {
    if (this.phase === 'ended') return this._deny(p, act, REASON.PHASE);
    if (p.status !== 'alive' || p.dying) return this._deny(p, act, REASON.DEAD);
    return true;
  }

  takeItem(p, key) {
    if (!this._canAct(p, 'take')) return;
    const it = this.items.get(String(key));
    if (!it) return this._deny(p, 'take', REASON.TAKEN);
    if (p.hidden) return this._deny(p, 'take', REASON.HIDDEN, { key });
    if (it.state !== 'world') return this._deny(p, 'take', REASON.TAKEN, { key });
    if (it.drawer != null && !this.drawerOpen.get(it.drawer)) return this._deny(p, 'take', REASON.NOT_NEAR, { key });
    if (!this._near(p, it.pos.x, it.pos.z, COOP.pickupRadius, it.pos.y) || !this._los(p, it.pos.x, it.pos.z)) return this._deny(p, 'take', REASON.NOT_NEAR, { key });
    if (it.type === 'fuse') {
      it.state = 'carried'; it.by = p.id; p.carry.add(it.key);
      this.makeNoise(p.pos.x, p.pos.z, NOISE.pickup, 'pegar');
      if (this.ai.state === 'dormant') this._wakeCreature();
    } else if (it.type === 'battery') { it.state = 'gone'; it.by = p.id; }
    else if (it.type === 'key') { it.state = 'carried'; it.by = p.id; p.hasKey = true; }
    this.room.broadcast({ t: 'item', key: it.key, st: it.state, by: it.by, pos: null });
  }

  // instala TODOS os fusiveis que o jogador carrega (como no solo). O 7o so entra com todos os vivos na area de reuniao.
  installFuses(p) {
    if (!this._canAct(p, 'install')) return;
    const pn = this.world.panel;
    if (!this._near(p, pn.x, pn.z, COOP.panelUseRadius, pn.y) || !this._los(p, pn.x, pn.z)) return this._deny(p, 'install', REASON.NOT_NEAR);
    if (p.hidden) return this._deny(p, 'install', REASON.HIDDEN);
    const keys = [...p.carry].filter(k => this.items.get(k)?.type === 'fuse').sort((a, b) => this.items.get(a).id - this.items.get(b).id);
    if (!keys.length) return this._deny(p, 'install', REASON.NOT_YOURS);
    let k = 0;
    for (const key of keys) {
      const it = this.items.get(key);
      if (it.state !== 'carried' || it.by !== p.id || this.installed.includes(it.id)) continue;   // sem duplicar nem contar duas vezes
      const wouldComplete = this.installed.length + 1 >= COOP.fusesTotal;
      if (wouldComplete) {
        const missing = this.missingAtMeeting();
        if (missing.length) { this._deny(p, 'install', REASON.GATHER, { missing: missing.map(q => q.name) }); break; }
      }
      it.state = 'installed'; it.by = null; p.carry.delete(key);
      this.installed.push(it.id);
      const n = this.installed.length;
      this.director.setFuses(directorFuses(n));
      this.lighting.setPowered(this.world.sectorsFor(n));
      this.makeNoise(pn.x, pn.z, NOISE.install, 'quadro');
      this.room.broadcast({ t: 'fuse', id: it.id, n, by: p.id, delay: k * 550 });
      this.room.broadcast({ t: 'item', key, st: 'installed', by: null });
      k++;
      if (wouldComplete) { this._completeFuses(); break; }
    }
  }

  missingAtMeeting() {
    return this.aliveList().filter(q => !(Math.hypot(q.pos.x - this.meet.x, q.pos.z - this.meet.z) <= COOP.meeting.radius && q.pos.y > -1));
  }

  // 7 fusiveis: a porta de saida destrava para todos; apagao + sirene + criatura enfurecida enquanto todos correm
  _completeFuses() {
    this.exitOpen = true; this.phase = 'finale';
    const d = this.world.exitDoor;
    d.exit = false; d.setOpen(true, d.cx, d.cz - 1);
    if (COOP.finaleOnUnlock) {
      this.lighting.setBlackout(true);
      this.director.startFinale();
      this.ai.enraged = true;
      const ai = this.ai;
      if (ai.state === 'dormant') ai.activate(this.world.creatureSpawn);
      const tgt = ai.nearestView();
      if (tgt && (ai.distToPlayer() > 25 || Math.abs(ai.pos.y - tgt.pos.y) > 2)) ai.investigate(tgt.pos.clone(), true);       // anda ate la (sem dutos)
      this.makeNoise(this.world.panel.x, this.world.panel.z, 60, 'sirene');
    }
    this.room.broadcast({ t: 'unlock' });
  }

  useDoor(p, id, want, fast = false) {
    if (!this._canAct(p, 'door')) return;
    const d = this.world.doors[id | 0];
    if (!d) return this._deny(p, 'door', REASON.NOT_NEAR);
    if (p.hidden) return this._deny(p, 'door', REASON.HIDDEN);
    if (!this._near(p, d.cx, d.cz, COOP.doorRadius, d.base + 1.1) || !this._los(p, d.cx, d.cz, d)) return this._deny(p, 'door', REASON.NOT_NEAR, { id });
    if (d.kind === 'X') return this._deny(p, 'door', REASON.LOCKED, { id });        // so abre ao completar os fusiveis
    if (d.locked) {
      if (!p.hasKey) return this._deny(p, 'door', REASON.NO_KEY, { id });
      d.locked = false; this.makeNoise(d.cx, d.cz, 6, 'cadeado');
      const key = [...this.items.values()].find(i => i.type === 'key');
      if (key) { key.state = 'used'; key.by = null; for (const q of this.players.values()) q.hasKey = false; this.room.broadcast({ t: 'item', key: key.key, st: 'used', by: null }); }
      return this._sendDoor(d, { unlock: true });
    }
    if (d.jammed) {
      if (d.sideOf(p.pos.x, p.pos.z) > 0) {
        d.jammed = false; this.makeNoise(d.cx, d.cz, 9, 'cano'); d.setOpen(true, p.pos.x, p.pos.z);
        return this._sendDoor(d, { pipe: true });
      }
      this.makeNoise(d.cx, d.cz, 5, 'porta');
      return this._deny(p, 'door', REASON.JAMMED, { id });
    }
    const opening = want === undefined || want === null ? !d.isOpen() : !!want;
    const isFast = !!fast && p.sprinting;
    if (opening === d.isOpen()) return this._sendDoor(d);          // ja esta assim: so ressincroniza
    d.setOpen(opening, p.pos.x, p.pos.z, isFast);
    this.makeNoise(d.cx, d.cz, isFast ? NOISE.doorSlam : NOISE.door, 'porta');
    this._sendDoor(d, { by: p.id });
  }

  _sendDoor(d, extra = {}) {
    const s = d.snapshot();
    d.sent = this._doorKey(d);
    this.room.broadcast({ t: 'door', id: d.id, ...s, ...extra });
  }

  useDrawer(p, num, open) {
    if (!this._canAct(p, 'drawer')) return;
    const d = this.world.drawers.find(q => q.num === (num | 0));
    if (!d) return this._deny(p, 'drawer', REASON.NOT_NEAR);
    if (p.hidden) return this._deny(p, 'drawer', REASON.HIDDEN);
    if (!this._near(p, d.x, d.z, COOP.doorRadius, d.y)) return this._deny(p, 'drawer', REASON.NOT_NEAR, { num });
    const want = open === undefined ? !this.drawerOpen.get(d.num) : !!open;
    this.drawerOpen.set(d.num, want);
    this.makeNoise(d.x, d.z + 0.2, NOISE.drawer, 'gaveta');
    this.room.broadcast({ t: 'drawer', num: d.num, open: want });
  }

  hide(p, spotId, on) {
    if (!this._canAct(p, 'hide')) return;
    if (!on) return this._unhide(p, false);
    if (p.hidden) return this._deny(p, 'hide', REASON.HIDDEN);
    const s = this.world.hideSpots[spotId | 0];
    if (!s) return this._deny(p, 'hide', REASON.NOT_NEAR);
    if (!this._near(p, s.x, s.z, COOP.hideRadius, s.base + 1)) return this._deny(p, 'hide', REASON.NOT_NEAR, { spot: spotId });
    if (s.occupant) return this._deny(p, 'hide', REASON.OCCUPIED, { spot: spotId });        // capacidade 1
    // visto entrando? entao o esconderijo nao serve (mesma regra do solo)
    const ai = this.ai;
    const seen = ai.state !== 'dormant' && ((ai.sees && ai.tgt === p.view) || (ai.state === 'chase' && ai.tgt === p.view && ai.lastSeenT < 1.2 && ai.distToPlayer() < 8));
    s.compromised = seen && ['chase', 'stalk'].includes(ai.state);
    s.occupant = p; p.hidden = s; p.holding = false; p.breath = 1; p.gasped = false; p.mv = MOVE.IDLE; p.sprinting = false;
    p.pos.set(s.x, s.base, s.z); p.updateEye();
    this.makeNoise(s.x, s.z, s.type === 'locker' ? NOISE.locker : 2, 'esconderijo');
    this.room.broadcast({ t: 'hide', id: p.id, spot: s.id, on: true });
  }

  _unhide(p, forced) {
    const s = p.hidden;
    if (!s) return;
    p.hidden = null; s.occupant = null; s.compromised = false;
    const g = this.grid;
    const [x, z] = g.collideCircle(s.exitPos.x, s.exitPos.z, PLAYER.radius);
    p.pos.set(x, g.floorY(x, z), z); p.yaw = s.yaw; p.crouch = s.type === 'bed' ? 1 : 0; p.updateEye();
    this.makeNoise(s.x, s.z, s.type === 'locker' ? NOISE.locker : 2, 'esconderijo');
    this.room.broadcast({ t: 'hide', id: p.id, spot: s.id, on: false, forced: !!forced, x: R3(p.pos.x), y: R3(p.pos.y), z: R3(p.pos.z), yaw: R3(p.yaw) });
  }

  // ruidos gerados no cliente (clique da lanterna): raio fixo definido aqui, nunca pelo cliente
  noise(p, kind) {
    if (!p.alive || this.phase === 'ended') return;
    const now = this.time;
    if (now - (p._noiseT ?? -9) < 0.15) return;
    p._noiseT = now;
    if (kind === 'clique') this.makeNoise(p.pos.x, p.pos.z, NOISE.flashlightClick, 'clique');
  }

  // ---------------- morte / saida de jogadores ----------------
  _kill(p) {
    if (p.status !== 'alive') return;
    p.status = 'dead'; p.dying = false; p.diedAt = this.time; this.stats.deaths++;
    if (p.hidden) { p.hidden.occupant = null; p.hidden.compromised = false; p.hidden = null; }
    p.holding = false; p.fl.on = false;
    p.ghostT = this._nextGhostBase();
    const drops = this._dropCarried(p);
    this.room.broadcast({ t: 'dead', id: p.id, drops });
    this.emit('dead', p.id);
    this._checkEnd();
  }

  // fusiveis (e chave) caem numa posicao livre e alcancavel perto do jogador; continuam sendo os mesmos itens
  _dropCarried(p) {
    const drops = [];
    for (const key of [...p.carry]) {
      const it = this.items.get(key);
      if (!it || it.state !== 'carried') continue;
      const spot = this.world.freeSpotNear(p.pos.x, p.pos.z, 0.3 + drops.length * 0.25, 2.5) || { x: p.pos.x, z: p.pos.z, y: p.pos.y };
      it.state = 'world'; it.by = null; it.pos = { x: R3(spot.x), y: R3(spot.y + 0.02), z: R3(spot.z) }; it.drawer = null;
      drops.push({ key, x: it.pos.x, y: it.pos.y, z: it.pos.z });
    }
    p.carry.clear();
    if (p.hasKey) {
      const it = [...this.items.values()].find(i => i.type === 'key' && i.state === 'carried' && i.by === p.id);
      if (it) {
        const spot = this.world.freeSpotNear(p.pos.x, p.pos.z, 0.6 + drops.length * 0.25, 2.5) || { x: p.pos.x, z: p.pos.z, y: p.pos.y };
        it.state = 'world'; it.by = null; it.pos = { x: R3(spot.x), y: R3(spot.y + 0.02), z: R3(spot.z) };
        drops.push({ key: it.key, x: it.pos.x, y: it.pos.y, z: it.pos.z });
      }
      p.hasKey = false;
    }
    return drops;
  }

  // saiu de vez (fim da janela de reconexao ou saiu da sala)
  removePlayer(p, why = 'left') {
    if (p.status === 'left') return;
    const wasAlive = p.status === 'alive';
    if (p.hidden) { p.hidden.occupant = null; p.hidden.compromised = false; p.hidden = null; }
    const drops = wasAlive ? this._dropCarried(p) : [];
    p.status = 'left'; p.conn = null;
    this.room.broadcast({ t: 'left', id: p.id, why, drops });
    this._checkEnd();
  }

  _checkExit(p) {
    if (!this.exitOpen || !p.alive) return;
    const e = this.world.exitTrigger;
    if (p.pos.z > e.z - 0.5 && Math.abs(p.pos.x - e.x) < 4) {
      p.status = 'escaped'; p.carry.clear();
      this.room.broadcast({ t: 'escaped', id: p.id });
      this._checkEnd();
    }
  }

  _checkEnd() {
    if (this.phase === 'ended') return;
    const alive = this.aliveList();
    if (alive.length) return;
    const escaped = [...this.players.values()].filter(q => q.status === 'escaped');
    this.end(escaped.length ? RESULT.WIN : RESULT.LOSE);
  }

  end(result) {
    if (this.phase === 'ended') return;
    this.phase = 'ended'; this.result = result;
    const stats = { time: Math.round(this.time), deaths: this.stats.deaths, repels: this.stats.repels, escaped: [...this.players.values()].filter(q => q.status === 'escaped').length, players: [...this.players.values()].filter(q => !q.watcher).length, fuses: this.installed.length };
    this.room.onEnd(result, stats);
  }

  // ---------------- conexao ----------------
  onDisconnect(p) {
    if (p.status === 'left') return;
    p.conn = null; p.offlineAt = this.time; p.mv = MOVE.IDLE; p.sprinting = false; p.holding = false;
    this.room.broadcast({ t: 'net', id: p.id, online: false });
  }
  onReconnect(p, conn) {
    p.conn = conn; p.offlineAt = null;
    // quem ja tinha saido de vez (janela esgotada) volta apenas como espectador: nunca ganha vida nova
    if (p.status === 'left') { p.status = 'dead'; p.diedAt = this.time; p.ghostT = this._nextGhostBase(); p.carry.clear(); p.hasKey = false; p.hidden = null; }
    this.room.broadcast({ t: 'net', id: p.id, online: true });
  }

  // ---------------- tick ----------------
  tick(dt) {
    if (this.phase === 'ended') return;
    this.time += dt; this.tickN++;
    const w = this.world;
    w.update(dt);

    for (const p of this.players.values()) this._tickPlayer(p, dt);

    const ai = this.ai;
    ai.update(dt);
    ai.visibleModel = ai.m.group.visible;
    if (ai.state !== 'dormant') ai.m.update(dt);
    this.director.update(dt);
    this._tickMimic(dt);

    // portas: sincroniza mudancas feitas pela criatura (ela abre portas ao passar)
    for (const d of w.doors) {
      if (d.sent !== this._doorKey(d)) this._sendDoor(d, { by: 'creature' });
    }
    // espiritos
    for (const p of this.players.values()) if (p.status === 'dead' && !p.watcher) this._tickGhost(p, dt);

    if (this.tickN % COOP.snapshotEvery === 0) this._broadcastSnapshots();
  }

  _tickPlayer(p, dt) {
    // fim da janela de reconexao: sai de vez
    if (p.offlineAt != null && p.status !== 'left' && this.time - p.offlineAt >= COOP.reconnectGrace) { this.removePlayer(p, 'timeout'); return; }
    if (p.status !== 'alive') return;
    if (p.hidden) {
      // respiracao: mesmas regras do solo (segurar ate HOLD_BREATH s; sem folego = arfa e faz barulho)
      const wasHolding = p.holding && !p.gasped;
      if (p.holding && p.breath > 0 && !p.gasped) {
        p.breath -= dt / HOLD_BREATH;
        if (p.breath <= 0) { p.breath = 0; p.gasped = true; this.makeNoise(p.pos.x, p.pos.z, NOISE.gasp, 'arfar'); }
      } else {
        p.breath = Math.min(1, p.breath + dt * 0.22);
        if (p.gasped && p.breath > 0.4) p.gasped = false;
      }
      void wasHolding;
    }
  }

  // aparicao do espirito: quem e quando e decidido AQUI, aleatoriamente; o morto nao controla nada disso
  _tickGhost(p, dt) {
    p.ghostT -= dt;
    if (p.ghostT > 0) return;
    p.ghostT = this._nextGhostBase();
    const G = COOP.ghost, g = this.grid;
    for (const v of this.aliveList()) {
      if (!v.connected) continue;
      // um lugar livre entre minDist e maxDist do vivo, de preferencia a frente dele; sem parede no meio
      let best = null;
      for (let k = 0; k < 24 && !best; k++) {
        // direcao do olhar do vivo: forward = (-sin yaw, -cos yaw); as 12 primeiras tentativas ficam a frente dele
        const ang = k < 12 ? v.yaw + (Math.random() - 0.5) * 1.2 : Math.random() * Math.PI * 2;
        const r = G.minDist + Math.random() * (G.maxDist - G.minDist);
        const x = v.pos.x - Math.sin(ang) * r, z = v.pos.z - Math.cos(ang) * r;
        const cx = g.cellX(x), cy = g.cellY(z);
        if (!g.isFloor(cx, cy) || Math.abs(g.floorY(x, z) - v.pos.y) > 1) continue;
        if (!g.segmentClear(v.pos.x, v.pos.z, x, z, true)) continue;
        best = { x, z, y: g.floorY(x, z) };
      }
      if (!best) continue;
      this.room.send(v, { t: 'ghost', x: R2(best.x), y: R2(best.y), z: R2(best.z), yaw: R2(Math.atan2(v.pos.x - best.x, v.pos.z - best.z)), dur: G.duration });
    }
  }

  // A criatura "fala" com a voz de um jogador que autorizou. O sorteio (quem, qual frase, quando) e SEMPRE do servidor.
  _tickMimic(dt) {
    this.mimicT -= dt;
    if (this.mimicT > 0) return;
    const ai = this.ai;
    if (ai.state === 'dormant' || !ai.visibleModel || !MIMIC.states.includes(ai.state) || this.time - this.lastMimic < MIMIC.minGap || this.phase === 'ended') { this.mimicT = 4; return; }
    // nao fala colada em alguem (o susto ja seria o proprio bote)
    for (const p of this.aliveList()) if (Math.hypot(p.pos.x - ai.pos.x, p.pos.z - ai.pos.z) < MIMIC.minPlayerDist) { this.mimicT = 4; return; }
    const voices = this.room.mimicVoices();
    if (!voices.length) { this.mimicT = 10; return; }
    const living = voices.filter(v => v.status === 'alive');
    const pool = living.length ? living : voices;
    const owner = pool[Math.floor(Math.random() * pool.length)];
    const fusesLeft = [...this.items.values()].some(i => i.type === 'fuse' && i.state !== 'installed');
    const ok = MIMIC.phrases.map((_, i) => i).filter(i => owner.mimic.clips.has(i) && (fusesLeft || !MIMIC.needsFuseLeft.includes(i)) && i !== this._lastPhrase);
    if (!ok.length) { this.mimicT = 10; return; }
    const i = ok[Math.floor(Math.random() * ok.length)];
    this._lastPhrase = i; this.lastMimic = this.time;
    this.mimicT = MIMIC.interval[0] + Math.random() * (MIMIC.interval[1] - MIMIC.interval[0]);
    const head = ai.m.headWorld(V());
    this.room.broadcast({ t: 'mimic', op: 'say', from: owner.id, i, x: R2(head.x), y: R2(head.y), z: R2(head.z) });
  }

  // ---------------- snapshots ----------------
  _creatureSnap() {
    const ai = this.ai, m = ai.m;
    const st = CREATURE_STATES.indexOf(ai.state);
    const a = m.actions[m.current];
    const look = ai.lookAtPos();
    const c = {
      x: R2(ai.pos.x), y: R2(ai.pos.y), z: R2(ai.pos.z), yw: R3(ai.yaw),
      s: st, u: Math.max(0, CREATURE_SUBS.indexOf(ai.sub)), sp: R2(ai.moveSpeed),
      cl: CLIPS.indexOf(m.current), ts: R2(a ? a.timeScale : 1), ps: m.playSeq,
      v: ai.visibleModel ? 1 : 0, bn: ai.burning ? 1 : 0, bg: R2(m.burnGlow), sh: R2(ai.shield), es: R2(m.eyeshine),
      t: R2(ai.stateT), lw: R2(m.lookWeight), en: ai.enraged ? 1 : 0,
    };
    if (look && m.lookWeight > 0.01) c.lk = [R2(look.x), R2(look.y), R2(look.z)];
    return c;
  }

  _flags(p) {
    return (p.hidden ? FLAG.HIDDEN : 0) | (p.holding && !p.gasped ? FLAG.BREATH : 0) | (p.fl.on ? FLAG.FLASH : 0) | (p.sprinting ? FLAG.SPRINT : 0)
      | (p.mv ? FLAG.MOVING : 0) | (p.status === 'dead' ? FLAG.SPECTATOR : 0) | (p.status === 'escaped' ? FLAG.ESCAPED : 0) | (p.connected ? 0 : FLAG.OFFLINE);
  }

  _broadcastSnapshots() {
    const creature = this._creatureSnap();
    const meet = this.installed.length >= COOP.fusesTotal - 1 ? this._meetInfo() : null;
    const ev = this.events; this.events = [];
    const all = [...this.players.values()].filter(q => q.status !== 'left');
    for (const p of this.players.values()) {
      if (!p.conn || p.status === 'left') continue;
      const ghostView = p.status !== 'alive';           // espiritos/escapados veem os outros espiritos; vivos so veem vivos
      const list = [];
      for (const q of all) {
        if (q === p) continue;
        const spectating = q.status === 'dead' || q.status === 'escaped';
        if (spectating && !ghostView) continue;         // espirito e invisivel para os vivos
        list.push([q.id, R2(q.pos.x), R2(q.pos.y), R2(q.pos.z), R2(q.yaw), R2(q.pitch), R2(q.crouch), this._flags(q), R2(q.fl.focus)]);
      }
      const msg = { t: 'snap', n: this.tickN, tm: R3(this.time), p: list, c: creature };
      if (ev.length) msg.ev = ev;
      if (meet) msg.m = meet;
      if (p.hidden) msg.br = R2(p.breath);
      p.conn.send(msg);
    }
  }

  _meetInfo() {
    const alive = this.aliveList();
    const missing = this.missingAtMeeting();
    return [alive.length - missing.length, alive.length, missing.map(q => q.id)];
  }

  // estado completo (inicio da partida e reconexao)
  fullSync(p) {
    const items = [];
    for (const it of this.items.values()) items.push({ key: it.key, st: it.state, by: it.by, x: it.pos.x, y: it.pos.y, z: it.pos.z, ...(it.drawer != null ? { dr: it.drawer } : {}) });
    const doors = this.world.doors.map(d => ({ id: d.id, ...d.snapshot() }));
    const spots = this.world.hideSpots.filter(s => s.occupant).map(s => ({ spot: s.id, id: s.occupant.id }));
    return {
      t: 'sync', phase: this.phase, time: R2(this.time), you: p.id, status: p.status, hidden: p.hidden ? p.hidden.id : null,
      pose: this.spawnPose(p), items, doors, spots, installed: this.installed.slice(), exitOpen: this.exitOpen, total: COOP.fusesTotal,
      lamps: this.lighting.dead(), power: this.installed.length, blackout: this.lighting.blackout,
      drawers: [...this.drawerOpen].filter(([, o]) => o).map(([n]) => n),
      players: [...this.players.values()].map(q => ({ id: q.id, name: q.name, status: q.status, online: q.connected, watcher: q.watcher })),
      carry: [...p.carry], hasKey: p.hasKey,
    };
  }

  dispose() { this.phase = 'ended'; }
}
