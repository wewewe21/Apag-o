// Cooperativo online no cliente: conexao, salas/lobby, partida (estado vindo do servidor), jogadores remotos, criatura em rede,
// itens/portas/esconderijos/quadro sincronizados, morte, espirito e fim de partida.
// O SERVIDOR e o dono do estado: aqui so se enviam intencoes (pegar, instalar, abrir, esconder) e se aplica o que ele confirma.
import * as THREE from 'three';
import * as CFG from '../config.js';
import { COOP } from '../shared/coop.js';
import { FLAG, MOVE, RESULT, REASON } from './protocol.js';
import { NetClient } from './netclient.js';
import { OnlineUI } from './onlineui.js';
import { RemotePlayers, GhostApparition } from './remote.js';
import { NetCreature } from './netcreature.js';
import { VoiceChat, MIC_STATUS } from '../voice/voicechat.js';
import { MimicClient } from '../voice/mimic/mimic.js';
import { MimicUi } from '../voice/mimic/mimicui.js';
import { clamp } from '../core/rng.js';

const $ = (id) => document.getElementById(id);
const NOTICE_KEY = 'apagao.notice.v1';
const DENY_TEXT = {
  [REASON.NOT_NEAR]: 'Muito longe (ou sem linha de visão).', [REASON.TAKEN]: 'Alguém já pegou isso.', [REASON.NOT_YOURS]: 'Você não está carregando fusíveis.',
  [REASON.DEAD]: 'Espíritos não interagem com o mundo.', [REASON.LOCKED]: 'A trava da porta principal só solta com os sete fusíveis.',
  [REASON.JAMMED]: 'Emperrada. Algo trava a porta do outro lado.', [REASON.NO_KEY]: 'Trancada — precisa da chave do subsolo.',
  [REASON.OCCUPIED]: 'Já tem alguém escondido aí.', [REASON.HIDDEN]: 'Saia do esconderijo primeiro.', [REASON.PHASE]: 'A partida terminou.',
};
const DUMMY_DIRECTOR = { fuses: 0, finale: false, menace: 0, update() {}, setFuses() {}, startFinale() {}, aggression() { return 1; }, biasPoint() { return null; } };

export class OnlineController {
  constructor(game) {
    this.g = game;
    this.net = new NetClient();
    this.ui = new OnlineUI({
      create: (name) => this.create(name), join: (code, name) => this.join(code, name), refresh: () => this.refreshRooms(),
      back: () => this.backToTitle(), ready: (on) => this.net.send({ t: 'ready', on }), start: () => this.net.send({ t: 'start' }),
      leave: () => this.leaveToMenu(), endBack: () => this.endBack(),
    });
    this.room = null; this.me = null; this.inMatch = false; this.ended = false;
    this.players = new Map();            // id -> { name, status, online }
    this.itemState = new Map();          // key -> { st, by, x, y, z }
    this.extra = new Map();              // fusiveis 6 e 7 criados so no cooperativo
    this.hp = null; this.creature = null; this.remote = null; this.ghost = null;
    this._sendT = null; this.lastSend = 0; this.notice = null;
    this._wire();
    this.voice = null;
    // eco de voz (opcional, so com autorizacao especifica): ver src/voice/mimic/
    this.mimicUi = new MimicUi();
    this.mimic = new MimicClient({ audio: game.audio, send: (o) => this.net.send(o), ui: this.mimicUi });
    this.mimicUi.bind(this.mimic);
    this.mimicUi.refresh();
    window.__online = this;
  }

  // ---------------- ligacao com o NetClient ----------------
  _wire() {
    const net = this.net, on = (t, f) => net.on(t, f.bind(this));
    net.onState((s, info) => this._onNetState(s, info));
    on('welcome', this._welcome); on('room', this._room); on('rooms', (m) => this.ui.rooms(m.rooms)); on('err', this._err);
    on('left_room', () => { this.room = null; });
    on('start', this._start); on('sync', this._sync); on('snap', this._snap);
    on('item', this._item); on('fuse', this._fuse); on('unlock', () => this.g.objectives.unlockOnline());
    on('door', this._door); on('drawer', this._drawer); on('hide', this._hide);
    on('caught', this._caught); on('dead', this._dead); on('left', this._left); on('escaped', this._escaped); on('net', this._netPeer);
    on('burn', (m) => this.g.hud?.burnMeter(m.v)); on('corr', this._corr); on('deny', this._deny); on('ghost', this._ghostMsg);
    on('end', this._end); on('host', (m) => this.g.hud?.toast(`${m.name} agora é o criador da sala.`, 4)); on('bye', () => this._fatal('O servidor foi reiniciado. A partida foi encerrada.'));
    on('dropped', () => { if (this.inMatch) this.g.hud?.toast('Conexão perdida. Tentando reconectar…', 4); });
    on('lost', () => this._fatal('Não foi possível reconectar ao servidor. A partida foi encerrada para você.'));
    on('replaced', () => this._fatal('Você conectou em outra aba: esta sessão foi encerrada.'));
    on('role', this._role);
    on('voice', (m) => this.voice?.onSignal(m));
    on('mimic', (m) => { this.mimic.me = this.me; this.mimic.receive(m); });
  }

  _onNetState(s, info) {
    const ui = this.ui;
    const secs = info?.seconds;
    if (s === 'waking' && this.inMatch) ui.banner(`Sem resposta do servidor — tentando reconectar (${secs}s). Seu personagem espera por você por alguns segundos.`, 'err');
    else if (s === 'waking') ui.banner(info.slow ? `Acordando o servidor… (${secs}s) O plano gratuito hiberna e pode levar cerca de 1 minuto.` : 'Contatando o servidor…');
    else if (s === 'connecting') ui.banner('Conectando ao servidor…');
    else if (s === 'reconnecting') ui.banner(`Conexão perdida — reconectando (tentativa ${info.attempt})…${this.inMatch ? ' Seu personagem espera por você.' : ''}`, 'err');
    else if (s === 'unavailable') {
      const why = { not_configured: 'Servidor online não configurado (veja runtime-config.js).', version: 'Versão do jogo diferente da do servidor: recarregue a página.', no_response: 'Servidor indisponível no momento. Tente de novo em instantes.', lost: 'Servidor indisponível.', rate: 'Conexão encerrada por excesso de mensagens.' }[info.reason] || 'Servidor indisponível.';
      ui.banner(why, 'err'); ui.status(why, 'err'); ui.enableMenu(false);
    } else if (s === 'connected') { ui.banner(''); ui.enableMenu(true); }
    else ui.banner('');
  }

  // ---------------- menu e lobby ----------------
  async openMenu() {
    const g = this.g;
    g.audio.init(g.prefs.volume);              // o clique em "Online" e o gesto que libera o audio
    $('title').hidden = true; g.state = 'online-menu';
    this.ui.showMenu(true);
    this.ui.enableMenu(false);
    this.ui.status(this.net.cfg.configured ? 'Conectando ao servidor…' : 'Servidor online não configurado: veja runtime-config.js (serverUrl).', this.net.cfg.configured ? '' : 'err');
    this.ui.rooms([]);
    const ok = await this.net.connect(this.ui.name());
    if (ok) { this.ui.status('Conectado. Crie uma sala ou entre por código.', 'ok'); this.refreshRooms(); this._roomsTimer = setInterval(() => { if (!this.ui || $('online').hidden) return; this.refreshRooms(); }, 4000); }
  }

  refreshRooms() { this.net.send({ t: 'rooms' }); }
  create(name) { this.ui.status('Criando sala…'); this.net.send({ t: 'create', name, roomName: name ? 'Sala de ' + name : undefined }); }
  join(code, name) {
    code = String(code || '').toUpperCase();
    if (code.length !== 4) { this.ui.status('O código tem 4 letras.', 'err'); return; }
    this.ui.status('Entrando…'); this.net.send({ t: 'join', code, name });
  }

  backToTitle() { clearInterval(this._roomsTimer); this.net.disconnect(true); this.ui.showMenu(false); this.ui.banner(''); location.reload(); }

  leaveToMenu() {
    this.net.send({ t: 'leave' });
    this.mimic.endSession();
    this.room = null; this.ui.showLobby(false); this.ui.showMenu(true); this.ui.status('Você saiu da sala.', ''); this.refreshRooms();
  }
  // menu de pausa -> "Menu inicial" durante a partida
  leaveRoom() { try { this.net.send({ t: 'leave' }); } catch { /* ok */ } this.voice?.stop(); this.mimic.endSession(); this.net.disconnect(true); this.stopLoops(); }

  _welcome(m) {
    this.me = m.id; this.mimic.me = m.id;
    if (m.expired && this.inMatch) this._fatal('O servidor reiniciou: a partida foi encerrada.');
    else if (m.expired) this.ui.status('O servidor reiniciou; sua sala anterior não existe mais.', 'err');
  }

  _err(m) {
    if (this.inMatch) { this.g.hud?.toast(m.msg || 'Erro do servidor.', 4); return; }
    if (!$('lobby').hidden) this.ui.lobbyStatus(m.msg || m.code, 'err'); else this.ui.status(m.msg || m.code, 'err');
  }

  _room(m) {
    this.room = m; this.me = m.you ?? this.me;
    const mine = m.members.find(p => p.id === this.me);
    this.myRole = mine?.role;
    this.players = new Map(m.members.map(p => [p.id, { name: p.name, status: p.status, online: p.online, watcher: !!p.watcher }]));
    if (m.phase === 'lobby' && !this.inMatch) {
      this.ui.showMenu(false); this.ui.showLobby(true); this.ui.lobby(m, this.me);
      if (this.myRole === 'spectator') $('mmBox').hidden = true;        // espectador nao cede a voz para a criatura
      else this.mimicUi.refresh();
      if (!this.g.world && !this._loading) this._preload();
    } else if (this.inMatch) {
      // gente entrando/saindo no meio da partida (espectadores): nomes, voz e quadro de jogadores acompanham
      this.remote?.setPlayers(m.members, this.me); this.voice?.setPlayers(m.members); this._roster();
    } else if (m.phase === 'playing') {
      // entrou com a partida em andamento: o estado chega logo depois; enquanto isso o mapa carrega e o aviso aparece
      this.ui.showMenu(false); this.ui.showLobby(true); this.ui.lobby(m, this.me);
      this.ui.lobbyStatus('Partida em andamento: preparando o mapa para você assistir…', '');
      if (!this.g.world && !this._loading) this._preload();
    }
  }

  // o servidor passou voce de espectador para jogador (alguem saiu): vale a partir do lobby da proxima rodada
  _role(m) {
    if (m.role !== 'player') return;
    this.ui.lobbyStatus('Abriu uma vaga: você agora é JOGADOR. Marque "Estou pronto".', 'ok');
    this.g.hud?.toast('Você agora é jogador na próxima rodada.', 5);
  }

  // aviso antes de sair da sala pelo menu de pausa (so avisa quando faz diferenca)
  confirmLeave() {
    if (!this.inMatch || this.ended) return true;
    const text = this.myRole === 'spectator' || this.players.get(this.me)?.watcher
      ? 'Sair da sala? Você está só assistindo; ao sair perde seu lugar na fila.'
      : 'Sair da partida? Seu personagem sai do jogo e a sua vaga vai para o primeiro da fila na próxima rodada. Os outros jogadores continuam.';
    return confirm(text);
  }

  // constroi o mapa enquanto o grupo espera no lobby (nao trava a tela de lobby)
  async _preload() {
    this._loading = true;
    try {
      await this.g.load((msg) => this.ui.lobbyStatus('Preparando o mapa: ' + msg, ''), true);
      this.g.post.uniforms.fade.value = 1;       // fundo preto atras do lobby
      this.ui.lobbyStatus('Mapa pronto. Aguardando o início.', 'ok');
    } catch (e) { this.ui.lobbyStatus('Falha ao carregar o mapa: ' + e.message, 'err'); }
    this._loading = false;
  }

  // ---------------- partida ----------------
  async _start(m) {
    this.pendingStart = m;
    this.ended = false; this.ui.hideEnd();
    this.g.hud?.toast('Iniciando…', 2);
  }

  async _sync(m) {
    if (this._syncing) { this._queuedSync = m; return; }
    this._syncing = true;
    try {
      const fresh = !this.inMatch;
      await this._enterWorld(m, fresh);
      this._applySync(m, fresh);
      this._queuedSync && this._applySync(this._queuedSync, false);
    } catch (e) { console.error(e); this._fatal('Erro ao preparar a partida: ' + e.message); }
    this._queuedSync = null; this._syncing = false;
  }

  async _enterWorld(m, fresh) {
    const g = this.g;
    while (this._loading) await new Promise(r => setTimeout(r, 100));        // o mapa ja esta sendo montado (entrada no lobby / com partida em andamento)
    if (!g.world) await g.load((msg) => this.ui.lobbyStatus('Preparando o mapa: ' + msg, ''), true);
    if (!fresh) return;
    g.mode = 'online'; g.online = this;
    g.audio.init(g.prefs.volume);
    if (g.objectives.total !== COOP.fusesTotal) g.objectives.buildPanel(COOP.fusesTotal);
    if (!this.creature) this.creature = new NetCreature(g, g.creatureModel);
    if (!this.remote) { this.remote = new RemotePlayers(g); this.ghost = new GhostApparition(g); this._meetDecal(); }
    g.soloAi = g.soloAi || g.ai; g.ai = this.creature; g.director = DUMMY_DIRECTOR;
    // mundo como no inicio da partida: nada instalado, itens no lugar, luzes de fabrica
    g.world.resetState(); g.objectives.reset(); g.particles.reset(); g.creatureFx.clear(); g.audio.stopSiren();
    g.haunting.reset(); g.paranoia.reset();
    this.creature.reset(); this.remote.clear(); this.remote.setXray(false); this.ghost.hide();
    const p = g.player, fl = g.flashlight;
    p.inventory = { fuses: [], key: false, map: false }; p.spawn(m.pose.x, m.pose.z, m.pose.yaw); p.dead = false; p.lookLock = null;
    g.deathScene?.reset();
    fl.battery = CFG.FLASHLIGHT.battery; fl.heat = 0; fl.overheat = 0; fl.focus = 0; fl.on = true;
    g.stats = { deaths: 0, repels: 0, start: g.time }; g.fear = 0; g.creatureNear = 0; g._deathT = undefined;
    const u = g.post.uniforms; u.pulse.value = 0; u.fade.value = 0; u.hideMask.value = 0; u.adapt.value = 0; u.burn.value = 0; u.ghost.value = 0;
    g.ambient.intensity = 0.35;
    this.itemState.clear();
    $('death').hidden = true; $('spectate').hidden = true;
    g._applyModeUi();
    this.ui.showLobby(false); this.ui.showMenu(false); $('loading').hidden = true; $('title').hidden = true;
    g.hud.show(true); $('roster').hidden = false; $('voicebar').hidden = false;
    g.hud.objective(`Sete fusíveis espalhados pelo prédio. Reúnam todos os vivos no quadro geral para instalar o último. Vocês têm uma vida cada.`, 10);
    this.inMatch = true; this.ended = false; this.spectating = false;
    g.state = 'playing'; g.input.enabled = true;
    g.grabMouse('start');
    this._startLoops();
    this._startVoice(m);
  }

  // aplica o estado COMPLETO enviado pelo servidor (inicio e reconexao): e idempotente
  _applySync(m, fresh) {
    const g = this.g, w = g.world;
    this.me = m.you; this.total = m.total;
    this.players = new Map(m.players.map(p => [p.id, { name: p.name, status: p.status, online: p.online, watcher: !!p.watcher }]));
    this.remote.setPlayers(m.players, m.you);
    this.voice?.setPlayers(m.players);
    // itens
    for (const it of m.items) {
      this.itemState.set(it.key, { st: it.st, by: it.by, x: it.x, y: it.y, z: it.z });
      if (it.key.startsWith('fuse:') && it.key !== 'fuse:4' && !this.findItem(it.key)) this._spawnExtra(it);
      const item = this.findItem(it.key);
      if (item) this._applyItem(item, it.st, it.by, it);
    }
    this._inventory();
    // portas (mesma ordem do servidor: confere a celula)
    for (const d of m.doors) { const door = w.doorsList[d.id]; if (door) this._setDoor(door, d, true); }
    // gavetas
    for (const d of w.drawers || []) {
      const open = m.drawers.includes(d.num);
      if (open) { w.drawerMesh(d); d.target = d.open = 1; w._updateDrawer(d, 0); const it = d.item && this.itemState.get('fuse:4'); if (it) this._applyItem(d.item, it.st, it.by, it); }
    }
    // luzes: lampadas estouradas pela criatura + quadro
    for (const i of m.lamps) { const l = g.lighting.lamps[i]; if (l) l.state = 'dead'; }
    for (const id of m.installed) g.objectives.install(id, true);
    g.lighting.computeLightMap();
    if (m.blackout) g.lighting.setBlackout(true);
    if (m.exitOpen && !g.objectives.doorOpen) { g.objectives.doorOpen = true; const d = w.exitDoor; d.exit = false; d.setOpen(true, d.cx, d.cz - 1); d.snap?.(1); g.audio.startSiren(); g.particles.setRainArea(22.5 * CFG.CELL, 27.5 * CFG.CELL, 29.5 * CFG.CELL, 32.5 * CFG.CELL); }
    // eu
    const p = g.player;
    if (!fresh) { p.pos.set(m.pose.x, m.pose.y, m.pose.z); p.vel.set(0, 0); }
    if (m.hidden != null && !p.hidden) g.applyHide(w.hideSpots[m.hidden], true);
    if (m.status !== 'alive' && !p.ghost) this._becomeGhost(this.players.get(m.you)?.watcher ? 'watch' : m.status);
    this._roster();
  }

  _spawnExtra(it) {
    const w = this.g.world;
    const item = w.spawnItem('fuse', it.key.split(':')[1] | 0, new THREE.Vector3(it.x, it.y, it.z));
    this.extra.set(it.key, item);
    return item;
  }

  findItem(key) {
    const g = this.g, w = g.world;
    if (this.extra.has(key)) return this.extra.get(key);
    if (key === 'fuse:4') { const d13 = w.drawers?.find(d => d.num === 13); return d13?.item || null; }
    return w.items.find(i => !i.parent && g.itemKey(i) === key) || null;
  }

  _applyItem(item, st, by, pos) {
    if (st === 'world') {
      item.taken = false; item.mesh.visible = true;
      if (pos && pos.x != null && item.parent !== undefined) {
        const w = this.g.world, mesh = item.mesh;
        if (mesh.parent !== w.scene) { mesh.parent?.remove(mesh); w.scene.add(mesh); item.parent = null; }
        const home = item.home;
        if (!home || Math.hypot(home.x - pos.x, home.z - pos.z) > 0.05 || Math.abs(home.y - pos.y) > 0.05) { mesh.position.set(pos.x, pos.y, pos.z); mesh.rotation.set(0, Math.random() * 6, 0); }
      }
    } else { item.taken = true; item.mesh.visible = false; }
  }

  _inventory() {
    const p = this.g.player, fuses = [];
    let key = false;
    for (const [k, s] of this.itemState) {
      if (s.st !== 'carried' || s.by !== this.me) continue;
      if (k.startsWith('fuse:')) fuses.push(+k.split(':')[1]); else if (k.startsWith('key:')) key = true;
    }
    p.inventory.fuses = fuses.sort((a, b) => a - b); p.inventory.key = key;
  }

  // ---------------- mensagens da partida ----------------
  _snap(m) {
    if (!this.inMatch) return;
    const t = performance.now() / 1000;
    this.remote.onSnap(m.p, t);
    if (m.c) this.creature.onSnap(m.c, t);
    if (m.ev) for (const e of m.ev) this._event(e);
    this._meet(m.m);
    this.breath = m.br;
  }

  _event(e) {
    const g = this.g, a = g.audio, v = (p) => ({ x: p[0], y: p[1], z: p[2] });
    switch (e[0]) {
      case 'cry': a.creatureCry(v(e[1]), e[2]); break;
      case 'sizzle': if (e[1]) a.sizzle(true, v(e[2])); else a.sizzle(false); break;
      case 'vrat': a.ventRattle(v(e[1])); break;
      case 'drat': a.doorRattle(v(e[1])); break;
      case 'slam': a.doorSlam(v(e[1]), 1); break;
      case 'vtrav': a.ventTravel({ x: e[1][0], base: e[1][1], z: e[1][2] }, { x: e[2][0], base: e[2][1], z: e[2][2] }, e[3]); break;
      case 'lbang': a.lockerBang(v(e[1])); break;
      case 'smoke': g.creatureFx.smokeBurst(new THREE.Vector3(...e[1])); g.stats.repels++; break;
      case 'lamp': { const l = g.lighting.lamps[e[1]]; if (l && l.state !== 'dead') g.burstLampVisual(l); break; }
      case 'wake': g.wakeCreatureFx(v(e[1])); break;
      default: break;
    }
  }

  _item(m) {
    const prev = this.itemState.get(m.key), st = { st: m.st, by: m.by, x: m.x ?? prev?.x, y: m.y ?? prev?.y, z: m.z ?? prev?.z };
    this.itemState.set(m.key, st);
    const item = this.findItem(m.key);
    if (item) this._applyItem(item, m.st, m.by, st);
    this._inventory();
    const g = this.g, mine = m.by === this.me;
    if (m.st === 'carried' && mine) {
      const type = m.key.split(':')[0];
      g.audio.pickup(type);
      if (type === 'fuse') {
        const left = g.fusesTotal - g.objectives.installed.length - g.player.inventory.fuses.length;
        g.hud.toast(left > 0 ? `Fusível de porcelana. Faltam ${left}. Leve ao quadro — se você morrer, ele cai onde você cair.` : 'Todos os fusíveis estão em campo. Volte ao quadro geral.', 5);
        if (g.ai.state === 'dormant') g.hud.objective('Algo acordou. Não deixe que ele te veja no escuro.', 5);
      } else if (type === 'key') g.hud.toast('Chave do subsolo. A porta fica no fim do corredor norte.', 4);
    } else if (m.st === 'gone' && mine && m.key.startsWith('battery')) {
      g.audio.pickup('battery'); g.flashlight.battery = Math.min(1, g.flashlight.battery + CFG.FLASHLIGHT.batteryPickup); g.hud.toast('Pilhas novas. Bateria da lanterna recarregada.');
    } else if (m.st === 'world' && prev?.st === 'carried' && prev.by !== this.me && item) {
      // caiu de outro jogador
    }
  }

  _fuse(m) {
    const g = this.g;
    setTimeout(() => {
      if (!this.inMatch) return;
      g.objectives.install(m.id, false);
      this._roster();
    }, m.delay || 0);
  }

  _door(m) {
    const door = this.g.world.doorsList[m.id];
    if (!door) return;
    this._setDoor(door, m, false);
  }

  _setDoor(door, m, instant) {
    const wasOpen = door.isOpen();
    door.locked = m.locked; door.jammed = m.jammed; door.exit = m.exit && !this.g.objectives.doorOpen;
    if (!door.locked && door.padlock) door.padlock.visible = false;
    if (!door.jammed && door.bar) door.bar.visible = false;
    door.dir = m.dir; door.target = m.open; door.speed = m.fast ? 7 : 2.4;
    if (instant) { door.open = door.target; door.snap?.(door.open); return; }
    if (m.by !== this.me && m.by !== 'creature' && wasOpen !== door.isOpen()) {
      const pos = new THREE.Vector3(door.cx, door.base + 1, door.cz);
      if (door.isOpen()) this.g.audio.doorOpen(pos, m.fast); else this.g.audio.doorClose(pos);
    }
    if (m.unlock) this.g.audio.metalHit(new THREE.Vector3(door.cx, door.base + 1, door.cz), 0.4);
    if (m.pipe) this.g.audio.metalHit(new THREE.Vector3(door.cx, door.base + 1, door.cz), 0.8);
    if (m.unlock && m.by === undefined) this.g.hud.toast('Cadeado aberto.');
  }

  _drawer(m) {
    const g = this.g, w = g.world, d = w.drawers.find(x => x.num === m.num);
    if (!d) return;
    w.drawerMesh(d); d.target = m.open ? 1 : 0;
    g.audio.drawer(new THREE.Vector3(d.x, d.y, w.drawerBank.zf + 0.3));
    if (d.item) { const s = this.itemState.get('fuse:4'); if (s) this._applyItem(d.item, s.st, s.by, s); }
  }

  _hide(m) {
    const g = this.g, spot = g.world.hideSpots[m.spot];
    if (!spot) return;
    if (m.id === this.me) {
      if (m.on) g.applyHide(spot, true);
      else { g.applyHide(spot, false, { x: m.x, y: m.y, z: m.z, yaw: m.yaw }); if (m.forced) spot.target = 1; }
    } else if (spot.type === 'locker') {
      spot.target = 1; setTimeout(() => { if (!(m.forced)) spot.target = 0; }, 400);
      g.audio.lockerMove(new THREE.Vector3(spot.x, spot.base + 1, spot.z));
    }
  }

  _caught(m) { const g = this.g; if (g.state === 'playing') g.onCaught(this.creature, m.hidden); }

  _dead(m) {
    const g = this.g;
    const pl = this.players.get(m.id); if (pl) pl.status = 'dead';
    this.voice?.setStatus(m.id, 'dead');       // fecha as conexoes de voz entre este jogador e os vivos
    for (const d of m.drops || []) { const s = this.itemState.get(d.key); const st = { st: 'world', by: null, x: d.x, y: d.y, z: d.z }; this.itemState.set(d.key, st); const it = this.findItem(d.key); if (it) this._applyItem(it, 'world', null, st); }
    this._inventory();
    if (m.id === this.me) {
      if (g.state === 'playing') g.onCaught(this.creature, false);       // morte sem aviso previo (ordem das mensagens): inicia a animacao de morte mesmo assim
      g.playerDies();
      g.player.inventory.fuses = []; g.player.inventory.key = false;
      $('deathTip').textContent = 'Você agora é um espírito. Os vivos não veem você — exceto por um instante, de tempos em tempos. Fusíveis que você carregava caíram onde você morreu.';
    } else {
      this.remote?.remove(m.id);
      g.hud.toast(`${this.remote?.name(m.id) ?? 'Alguém'} morreu.`, 4);
      g.audio.stinger(0.4);
    }
    this._roster();
  }

  _left(m) {
    const pl = this.players.get(m.id); if (pl) pl.status = 'left';
    this.voice?.setStatus(m.id, 'left');
    for (const d of m.drops || []) { const st = { st: 'world', by: null, x: d.x, y: d.y, z: d.z }; this.itemState.set(d.key, st); const it = this.findItem(d.key); if (it) this._applyItem(it, 'world', null, st); }
    this._inventory(); this.remote?.remove(m.id);
    this.g.hud.toast(`${this.remote?.name(m.id) ?? 'Alguém'} saiu da partida.`, 4);
    this._roster();
  }

  _netPeer(m) {
    const pl = this.players.get(m.id); if (pl) pl.online = m.online;
    this.voice?.setOnline(m.id, m.online);
    if (m.id !== this.me) this.g.hud.toast(`${this.remote?.name(m.id) ?? 'Alguém'} ${m.online ? 'voltou à partida' : 'perdeu a conexão'}.`, 3);
    this._roster();
  }

  _escaped(m) {
    const pl = this.players.get(m.id); if (pl) pl.status = 'escaped';
    this.voice?.setStatus(m.id, 'escaped');
    if (m.id === this.me) { this.g.hud.toast('Você saiu! Continue assistindo os outros.', 6); this._becomeGhost('escaped'); }
    else { this.remote?.remove(m.id); this.g.hud.toast(`${this.remote?.name(m.id) ?? 'Alguém'} escapou!`, 4); }
    this._roster();
  }

  _corr(m) { const p = this.g.player; if (p.hidden) return; p.pos.set(m.x, m.y, m.z); p.vel.set(0, 0); }
  _deny(m) {
    const g = this.g;
    if (m.reason === REASON.GATHER) g.hud.toast(`Reúnam todos os sobreviventes no ponto de reunião para o último fusível. Faltam: ${(m.missing || []).join(', ')}.`, 6);
    else g.hud.toast(DENY_TEXT[m.reason] || 'Não foi possível.', 3);
    if (m.act === 'door' && (m.reason === REASON.NO_KEY || m.reason === REASON.JAMMED || m.reason === REASON.LOCKED)) {
      const d = g.world.doorsList[m.id]; if (d) g.audio.locked(new THREE.Vector3(d.cx, d.base + 1, d.cz));
    }
    if (m.act === 'door' && m.id != null) { const d = g.world.doorsList[m.id]; if (d && !d.locked && !d.jammed && d.kind === 'D') { /* volta ao estado oficial na proxima mensagem */ } }
  }

  _ghostMsg(m) { if (!this.g.player.ghost) this.ghost.show(m.x, m.y, m.z, m.yaw, m.dur); }

  _end(m) {
    const g = this.g;
    this.ended = true; this.stopLoops(); this.voice?.stop();
    this.mimic.endSession();                   // fim da partida: amostra, modelo e falas somem deste navegador (o servidor tambem apaga)
    g.state = 'ended'; g.input.exitLock(); g.input.clearState();
    g.audio.stopSiren(); $('spectate').hidden = true; $('meet').hidden = true;
    this.ghost?.hide();
    setTimeout(() => this.ui.end(m.result, m.stats, m.players, this.me), 1500);
  }

  endBack() {
    const g = this.g;
    this.ui.hideEnd(); this.inMatch = false;
    $('roster').hidden = true; $('voicebar').hidden = true; g.hud.show(false);
    g.player.ghost = false; g.post.uniforms.ghost.value = 0; g.post.uniforms.fade.value = 1; g.post.uniforms.fadeColor.value.setRGB(0, 0, 0);
    g.state = 'lobby'; this.voice?.onMatchEnd?.();
    this.remote?.clear(); this.remote?.setXray(false); this.creature?.reset(); g.creatureFx.clear();
    this.ui.showLobby(true); if (this.room) this.ui.lobby(this.room, this.me);
    this.net.send({ t: 'rooms' });
  }

  // ---------------- morto / espirito ----------------
  becomeSpectator() { $('death').hidden = true; this._becomeGhost('dead'); this.g.state = 'playing'; this.g.grabMouse(); }

  _becomeGhost(kind) {
    const g = this.g, p = g.player;
    this.spectating = true;
    this.voice?.setStatus(this.me, kind === 'escaped' ? 'escaped' : 'dead');
    p.ghost = true; p.dead = false; p.lookLock = null; p.hidden = null; p.holdingBreath = false;
    this.remote?.setXray(true);                // visao noturna: ve os outros atraves das paredes (silhueta fraca)
    g.deathScene?.reset();
    g.flashlight.on = false; g.creatureFx.clear();
    const u = g.post.uniforms; u.ghost.value = 1; u.fade.value = 0; u.pulse.value = 0; u.hideMask.value = 0; u.adapt.value = 0;
    $('spectate').hidden = false;
    $('spectate').firstChild.textContent = kind === 'escaped' ? 'Você escapou — assistindo os outros' : kind === 'watch' ? 'Espectador — você joga quando abrir vaga, na próxima rodada' : 'Espírito — você não pode interagir';
    const hint = $('spectate').querySelector('span');
    if (hint) { this._hint0 = this._hint0 ?? hint.textContent; hint.textContent = kind === 'watch' ? 'WASD para andar · atravesse paredes · veja os vivos mesmo atrás delas · eles não veem você' : this._hint0; }
    if (g.state === 'dying' || g.state === 'dead') g.state = 'playing';
    this.ghost?.hide();
  }

  // ---------------- pedidos ao servidor ----------------
  requestTake(it) { this.net.send({ t: 'take', key: this.g.itemKey(it) }); }
  requestInstall() { this.net.send({ t: 'install' }); }
  requestDrawer(d) { this.net.send({ t: 'drawer', num: d.num, open: d.target < 0.5 }); }
  requestHide(spot, on) { this.net.send({ t: 'hide', spot: this.g.world.hideSpots.indexOf(spot), on }); }
  sendNoise(kind) { this.net.send({ t: 'noise', k: kind }); }
  requestDoor(d) {
    const g = this.g, p = g.player, id = g.world.doorsList.indexOf(d);
    const want = !d.isOpen(), fast = !!p.sprinting;
    // portas comuns abrem na hora (o servidor confirma e corrige se precisar); trancadas/emperradas esperam a resposta
    if (d.kind === 'D' && !d.locked && !d.jammed) {
      const pos = new THREE.Vector3(d.cx, d.base + 1, d.cz);
      d.setOpen(want, p.pos.x, p.pos.z, fast);
      if (want) g.audio.doorOpen(pos, fast); else g.audio.doorClose(pos);
    }
    this.net.send({ t: 'door', id, open: want, fast });
  }

  // ---------------- laco por quadro ----------------
  _startLoops() {
    this.stopLoops();
    this._sendT = setInterval(() => this._sendState(), 1000 / COOP.clientSendHz);
  }
  stopLoops() { clearInterval(this._sendT); this._sendT = null; clearInterval(this._roomsTimer); }

  _sendState() {
    const g = this.g, p = g.player, fl = g.flashlight;
    if (!this.inMatch || this.ended || !this.net.online) return;
    const active = !document.hidden && g.input.enabled && (g.state === 'playing' || g.state === 'paused' || g.state === 'reading' || g.state === 'map');
    let mv = MOVE.IDLE;
    if (active && p.moving && !p.hidden) mv = p.sprinting ? MOVE.SPRINT : p.crouch > 0.5 ? MOVE.CROUCH : MOVE.WALK;
    const yaw = p.hidden ? p.hidden.yaw + Math.PI + p.hideYaw : p.yaw, pitch = p.hidden ? p.hidePitch : p.pitch;
    const lit = fl.on && !p.hidden && !p.ghost && fl.spot.intensity > 1;
    this.net.send({ t: 's', x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3), yw: +yaw.toFixed(3), pt: +pitch.toFixed(3), cr: +p.crouch.toFixed(2), mv, fl: [lit ? 1 : 0, +fl.focus.toFixed(2)], hb: p.holdingBreath ? 1 : 0 });
  }

  update(dt) {
    if (!this.inMatch) return;
    const g = this.g, now = performance.now() / 1000;
    this.remote?.update(dt, now);
    this.ghost?.update(dt);
    this._voiceUpdate(dt, now);
    // decal do ponto de reuniao: ambar enquanto falta gente, verde quando completo
    if (this._meetMat) this._meetMat.opacity = 0.55 + Math.sin(now * 2) * 0.15;
  }

  // ---------------- HUD ----------------
  _roster() {
    const el = $('roster'); if (!el) return;
    const lines = [];
    for (const [id, p] of this.players) {
      const cls = [id === this.me ? 'me' : '', (p.status === 'dead' && !p.watcher) || p.status === 'left' ? 'dead' : '', p.watcher ? 'watch' : '', p.online === false ? 'off' : '', this.voiceTalking(id) ? 'talk' : ''].join(' ').trim();
      const tag = p.status === 'left' ? ' (saiu)' : p.watcher ? ' (espectador)' : p.status === 'dead' ? ' ✝' : p.status === 'escaped' ? ' ✔' : p.online === false ? ' (sem conexão)' : '';
      lines.push(`<div class="${cls}">${p.name.replace(/[&<>]/g, '')}${tag}</div>`);
    }
    el.innerHTML = lines.join('');
  }

  voiceTalking(id) { return this.voice?.speaking?.(id) || (id === this.me && !!this.voice?.mySpeaking); }

  _meet(info) {
    const el = $('meet');
    if (!info || this.spectating) { el.hidden = true; if (this._meetMat) this._meetMat.color.setHex(0xd2b35c); return; }
    const [inZone, total, missing] = info;
    const names = missing.map(id => this.remote?.name(id) || (id === this.me ? 'você' : '?'));
    el.hidden = false; el.className = missing.length ? '' : 'ok';
    el.textContent = missing.length ? `Ponto de reunião no quadro geral: ${inZone}/${total} — falta: ${names.join(', ')}` : `Todos reunidos (${inZone}/${total}): instalem o último fusível`;
    if (this._meetMat) this._meetMat.color.setHex(missing.length ? 0xd2b35c : 0x6fd08a);
  }

  // marcacao no chao: area de reuniao junto ao quadro
  _meetDecal() {
    const g = this.g, o = g.objectives;
    const cx = o.pos.x, cz = o.pos.z - COOP.meeting.forward, R = COOP.meeting.radius;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d');
    x.translate(256, 256); x.strokeStyle = '#fff'; x.lineWidth = 10; x.setLineDash([34, 22]);
    x.beginPath(); x.arc(0, 0, 236, 0, Math.PI * 2); x.stroke();
    x.setLineDash([]); x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 222, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#fff'; x.font = '700 40px "Barlow Condensed", "Arial Narrow", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('PONTO DE REUNIÃO', 0, -18); x.font = '500 28px "Barlow Condensed", sans-serif'; x.fillText('todos os vivos aqui', 0, 26);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = this._meetMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd2b35c, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), mat);
    m.rotation.set(-Math.PI / 2, 0, Math.PI); m.position.set(cx, g.grid.floorY(cx, cz) + 0.012, cz); m.renderOrder = 2;   // texto legivel para quem vem do norte em direcao ao quadro
    g.scene.add(m); this.meetMesh = m;
  }

  // ---------------- voz ----------------
  async _ice() {
    const cfg = this.net.cfg;
    if (cfg.iceServers && cfg.iceServers.length) return cfg.iceServers;
    const r = await fetch(cfg.http + '/ice', { cache: 'no-store' });
    return (await r.json()).iceServers;
  }

  _startVoice(m) {
    const g = this.g;
    if (!this.voice) {
      this.voice = new VoiceChat({ audio: g.audio, game: g, signal: (to, data) => this.net.send({ t: 'voice', to, data }), ice: () => this._ice() });
      this._bindVoiceUi();
    }
    this.voice.onChange = () => this._voiceUi();
    this.voice.start(this.me, m.players);
    $('voicebar').hidden = false;
    // o navegador pede a permissao do microfone aqui; se negar (ou nao houver), a partida segue normalmente
    this.voice.enableMic().then(() => this._voiceUi());
    this._voiceUi();
  }

  _bindVoiceUi() {
    const v = () => this.voice;
    $('btnMic').onclick = () => v().toggleMute();
    $('btnVoiceCfg').onclick = () => { this.g.pause('menu'); $('voicePanel').scrollIntoView?.(); this._voiceUi(); this._fillDevices(); };
    $('vpMute').onclick = () => v().toggleMute();
    $('vpEnable').onclick = async () => { await v().enableMic($('vpDevice').value); this._fillDevices(); };
    $('vpVol').oninput = (e) => v().setVolume(e.target.value);
    $('vpDevice').onchange = (e) => v().enableMic(e.target.value);
  }

  async _fillDevices() {
    const sel = $('vpDevice'), list = await this.voice.devices();
    sel.innerHTML = '<option value="">Padrão do sistema</option>' + list.map(d => `<option value="${d.deviceId.replace(/"/g, '')}">${(d.label || 'Microfone').replace(/[<>&]/g, '')}</option>`).join('');
    sel.value = this.voice.prefs.deviceId || '';
  }

  _voiceUi() {
    const vc = this.voice; if (!vc) return;
    const on = vc.micStatus === 'on', muted = vc.micStatus === 'muted';
    $('btnMic').textContent = muted ? 'Mic mudo' : on ? 'Mic ativo' : 'Mic';
    $('btnMic').classList.toggle('muted', muted || !on);
    $('voiceState').textContent = vc.micStatus === 'denied' || vc.micStatus === 'nodevice' || vc.micStatus === 'unsupported' || vc.micStatus === 'error' || vc.micStatus === 'busy' ? 'sem mic' : `voz ${vc.peers.size}`;
    $('voicePanel').hidden = !this.inMatch;
    $('vpStatus').textContent = MIC_STATUS[vc.micStatus] + (vc.peers.size ? ` · ${[...vc.peers.keys()].filter(id => vc.connected(id)).length}/${vc.peers.size} conectados` : '');
    $('vpStatus').className = 'status ' + (on ? 'ok' : muted ? '' : 'err');
    $('vpMute').textContent = muted ? 'Ativar meu microfone' : 'Silenciar meu microfone';
    $('vpVol').value = vc.prefs.volume;
    $('vpEnable').hidden = on || muted;
  }

  _voiceUpdate(dt, now) {
    const vc = this.voice;
    if (!vc || !vc.running) return;
    const g = this.g, cam = g.camera.position;
    vc.update(dt, now, cam,
      (id) => { const a = this.remote?.avatars.get(id); return a ? a.group.position : null; },
      (pos) => !g.grid.segmentClear(cam.x, cam.z, pos.x, pos.z, true));
    // marca quem esta falando no quadro de jogadores
    this._talkT = (this._talkT || 0) + dt;
    if (this._talkT > 0.3) { this._talkT = 0; const key = [...vc.peers.keys()].filter(id => vc.speaking(id)).join(); if (key !== this._talkKey) { this._talkKey = key; this._roster(); } }
  }

  // ---------------- falhas fatais ----------------
  _fatal(text) {
    this.stopLoops(); this.voice?.stop(); this.mimic.endSession(); this.net.disconnect(true);
    try { sessionStorage.setItem(NOTICE_KEY, text); } catch { /* ok */ }
    this.g.input.exitLock();
    this.ui.banner(text, 'err');
    setTimeout(() => location.reload(), 2500);
  }
}
