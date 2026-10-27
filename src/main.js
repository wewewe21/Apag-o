// APAGÃO — Hospital-Colônia Santa Lúcia
// Orquestra renderizacao, mundo, jogador, lanterna, criatura, diretor, objetivos, audio e telas.
import * as THREE from 'three';
import * as CFG from './config.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadSave, writeSave, clearSave, loadPrefs, savePrefs } from './core/save.js';
import { clamp, damp, range, mulberry32 } from './core/rng.js';
import { World } from './world/world.js';
import { SECTOR_ORDER } from './world/layout.js';
import * as P from './world/props.js';
import { textTexture } from './world/textures.js';
import { Player } from './entities/player.js';
import { Flashlight } from './entities/flashlight.js';
import { CreatureModel, loadCreatureAnims } from './entities/creature.js';
import { loadGuardianAsset } from './entities/guardian-asset.js';
import { CreatureAI } from './entities/creatureAI.js';
import { DeathScene } from './entities/deathscene.js';
import { loadModelLibrary, MODELS_MANIFEST } from './world/models.js';
import { Director } from './entities/director.js';
import { Haunting } from './entities/haunting.js';
import { DarkParanoia } from './entities/dark-paranoia.js';
import { PostFX } from './fx/postfx.js';
import { Particles } from './fx/particles.js';
import { CreatureFx } from './fx/creaturefx.js';
import { Hud } from './ui/hud.js';
import { BindsUI } from './ui/bindsui.js';
import { collectFuseSpots, pickFuseLayout, fuseHints } from './shared/fusespots.js';
import { OnlineController } from './net/online.js';

const $ = (id) => document.getElementById(id);
const { CELL, FUSES_TOTAL, DOOR_CHARGE_TIME, QUALITY, NOISE } = CFG;

class Objectives {
  constructor(game) {
    this.game = game;
    this.installed = [];
    this.charging = false; this.charge = 0; this.doorOpen = false; this.lever = 0;
    this.holdT = 0;
    this.total = FUSES_TOTAL;        // 5 no solo; 7 no cooperativo
  }

  // remove o painel para reconstruir com outro numero de encaixes (o cooperativo tem 7)
  _destroyPanel() {
    const w = this.game.world;
    w.scene.remove(this.group);
    const i = w.interactables.findIndex(it => it.kind === 'panel');
    if (i >= 0) w.interactables.splice(i, 1);
  }

  buildPanel(total = FUSES_TOTAL) {
    if (this.group) this._destroyPanel();
    this.total = total;
    const w = this.game.world, M = w.M, spec = w.panelSpec;
    const dir = [0, 1];
    const pos = w.anchor(spec.x, spec.y, dir, 0.2);
    const g = new THREE.Group();
    g.position.set(pos.x, 1.2, pos.z); g.rotation.y = w.yawFacingAway(dir);
    w.scene.add(g);
    P.box(g, M.steelDark, 0.82, 1.02, 0.03, 0, 0, -0.09);
    for (const [x, y, ww, hh] of [[-0.4, 0, 0.03, 1.02], [0.4, 0, 0.03, 1.02], [0, 0.5, 0.82, 0.03], [0, -0.5, 0.82, 0.03]]) P.box(g, M.cabinet, ww, hh, 0.2, x, y, 0);
    // porta do quadro aberta
    const door = new THREE.Group(); door.position.set(-0.41, 0, 0.1); door.rotation.y = -1.9; g.add(door);
    P.box(door, M.cabinet, 0.8, 1.0, 0.02, 0.4, 0, 0);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.14), new THREE.MeshStandardMaterial({ map: textTexture(['QUADRO GERAL', 'TRAVA DA PORTA PRINCIPAL'], { w: 512, h: 128, bg: '#c9b24a', color: '#151510', font: '600 40px "Barlow Condensed", "Arial Narrow", sans-serif' }), roughness: 0.7 }));
    lbl.position.set(0, 0.38, -0.07); g.add(lbl);
    this.sockets = [];
    const gap = total > 5 ? 0.12 : 0.14;
    for (let i = 0; i < total; i++) {
      const x = (i - (total - 1) / 2) * gap;
      P.box(g, M.ceramic, 0.1, 0.2, 0.05, x, 0.02, -0.055);
      P.box(g, M.brass, 0.02, 0.05, 0.02, x, 0.1, -0.03); P.box(g, M.brass, 0.02, 0.05, 0.02, x, -0.06, -0.03);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5a0a06, toneMapped: false }));
      lamp.position.set(x, 0.22, -0.06); g.add(lamp);
      const fuse = P.fuseMesh(M); fuse.rotation.set(0, 0, Math.PI / 2); fuse.position.set(x, -0.03, -0.02); fuse.visible = false; g.add(fuse);
      this.sockets.push({ lamp, fuse });
    }
    // alavanca
    this.leverPivot = new THREE.Group(); this.leverPivot.position.set(0.3, -0.2, -0.02); g.add(this.leverPivot);
    P.box(g, M.steelDark, 0.08, 0.12, 0.06, 0.3, -0.2, -0.05);
    P.cyl(this.leverPivot, M.redPaint, 0.018, 0.3, 0, 0.15, 0.03);
    P.sph(this.leverPivot, M.black, 0.035, 0.035, 0.035, 0, 0.3, 0.03);
    this.leverPivot.rotation.x = 0.9;
    // conduite ate a trava magnetica
    P.cyl(g, M.steelDark, 0.025, 1.9, 0.2, 1.45, -0.06);
    this.group = g;
    this.pos = new THREE.Vector3(pos.x, 1.2, pos.z);
    w.interactables.push({
      kind: 'panel', obj: g, radius: 0.6, pos: () => this.pos.clone(),
      prompt: () => this.prompt(), use: () => this.use(), hold: () => !this.game.online && this.installed.length >= this.total && !this.charging && !this.doorOpen,
    });
  }

  prompt() {
    const p = this.game.player;
    if (this.doorOpen) return 'Quadro geral: porta liberada';
    if (this.charging) return `Carregando a trava… ${Math.floor(this.charge * 100)}%`;
    if (p.inventory.fuses.length) return `Instalar ${p.inventory.fuses.length > 1 ? 'fusíveis' : 'fusível'} (${p.inventory.fuses.length})`;
    if (this.installed.length >= this.total && !this.game.online) return 'Puxar a alavanca (segure)';
    return `Quadro geral: ${this.installed.length}/${this.total} fusíveis`;
  }

  use() {
    const g = this.game, p = g.player;
    if (g.online) { g.online.requestInstall(); return; }     // cooperativo: o servidor valida posse, distancia e reuniao
    if (p.inventory.fuses.length) {
      const list = p.inventory.fuses.splice(0);
      list.forEach((id, k) => setTimeout(() => this.install(id), k * 550));
      return;
    }
    if (this.installed.length < this.total) g.hud.toast(`Faltam ${this.total - this.installed.length} fusíveis.`);
  }

  install(id, silent = false) {
    const g = this.game, T = this.total;
    if (this.installed.includes(id)) return;
    this.installed.push(id);
    const s = this.sockets[this.installed.length - 1];
    s.fuse.visible = true; s.lamp.material.color.set(0x38ff5a);
    g.director.setFuses(this.installed.length);
    g.lighting.setPowered(SECTOR_ORDER.slice(0, this.installed.length), !silent);
    if (silent) return;
    g.audio.fuseInsert(this.pos);
    g.audio.lightsOn();
    g.makeNoise(this.pos.x, this.pos.z, NOISE.install, 'quadro');
    const zoneNames = { 1: 'Recepção', 2: 'Corredor Norte', 3: 'Ala de Pacientes e Laboratório', 4: 'Enfermaria e Necrotério', 5: 'Segurança e Arquivo', 6: 'Subsolo' };
    const n = this.installed.length;
    if (n < T) {
      g.hud.toast(`Fusível instalado (${n}/${T}). Luz de volta: ${zoneNames[n] || ''}.`, 4);
      g.hud.objective(`Fusíveis: ${n}/${T}. Luz é segurança — mas ele fica mais inquieto a cada fusível.`);
    } else if (g.online) {
      g.hud.toast('Sete fusíveis. A porta principal destravou!', 4);
    } else {
      g.hud.toast('Cinco fusíveis. A trava está pronta.', 4);
      g.hud.objective('Puxe a alavanca do quadro geral. Quando a porta carregar, todo o prédio apaga.');
    }
    g.checkpoint('fusivel');
  }

  // quadro de energia como no inicio da partida (sem fusiveis, alavanca para cima, porta trancada)
  reset() {
    this.installed = []; this.charging = false; this.charge = 0; this.doorOpen = false; this.holdT = 0;
    this.sockets.forEach(sk => { sk.fuse.visible = false; sk.lamp.material.color.set(0x5a0a06); });
    this.leverPivot.rotation.x = 0.9;
    this.game.hud?.holdMeter(0);
  }

  holdUpdate(dt, holding) {
    if (!holding || this.charging || this.doorOpen || this.installed.length < this.total) { this.holdT = 0; this.game.hud.holdMeter(0); return; }
    this.holdT += dt;
    this.leverPivot.rotation.x = 0.9 - Math.min(1, this.holdT / 1.2) * 1.8;
    this.game.hud.holdMeter(Math.min(1, this.holdT / 1.2));
    if (this.holdT >= 1.2) { this.holdT = 0; this.game.hud.holdMeter(0); this.startCharge(); }
  }

  startCharge() {
    const g = this.game;
    this.charging = true; this.charge = 0;
    this.leverPivot.rotation.x = -0.9;
    g.audio.lever(); g.audio.startSiren();
    g.lighting.setBlackout(true);
    g.director.startFinale();
    g.ai.enraged = true;
    g.hud.toast('A trava está carregando. As luzes se foram.', 4);
    g.hud.objective('Sobreviva até a porta destravar.');
    g.makeNoise(this.pos.x, this.pos.z, 60, 'sirene');
    // manda a criatura ate o jogador se estiver longe (anda pelo chao e pelas escadas: nao ha dutos)
    const ai = g.ai;
    if (ai.state === 'dormant') ai.activate(g.world.creatureSpawn);
    if (ai.distToPlayer() > 25 || Math.abs(ai.pos.y - g.player.pos.y) > 2) ai.investigate(g.player.pos.clone(), true);
    g.stats.chargeStart = g.time;
  }

  update(dt) {
    const g = this.game;
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt / DOOR_CHARGE_TIME);
      const k = Math.floor(this.charge * this.total * 2) % 2;
      this.sockets.forEach((s, i) => s.lamp.material.color.set(i < this.charge * this.total ? 0x38ff5a : (k ? 0xffd040 : 0x2a2a10)));
      if (this.charge >= 1) this.openDoor();
    }
    const d = g.world.exitDoor;
    if (d?.led) d.led.material.color.set(this.doorOpen ? 0x30ff50 : this.charging ? (Math.sin(g.time * 12) > 0 ? 0xffc020 : 0x301000) : 0xff2010);
  }

  // cooperativo: o servidor completou os 7 fusiveis; apagao + sirene e a porta abre para todos
  unlockOnline() {
    const g = this.game;
    this.doorOpen = true;
    g.lighting.setBlackout(true);
    g.audio.startSiren(); g.audio.unlock();
    const d = g.world.exitDoor;
    d.exit = false; d.setOpen(true, d.cx, d.cz - 1);
    g.hud.toast('A TRAVA SOLTOU. TODOS PARA A SAÍDA!', 5);
    g.hud.objective('SAIA! A porta principal está aberta.', 8);
    g.particles.setRainArea(22.5 * CELL, 27.5 * CELL, 29.5 * CELL, 32.5 * CELL);
  }

  openDoor() {
    const g = this.game;
    this.charging = false; this.doorOpen = true;
    g.audio.stopSiren(); g.audio.unlock();
    const d = g.world.exitDoor;
    d.setOpen(true, d.cx, d.cz - 1);
    d.exit = false;
    g.hud.toast('A TRAVA SOLTOU. CORRA!', 4);
    g.hud.objective('SAIA!');
    g.particles.setRainArea(22.5 * CELL, 27.5 * CELL, 29.5 * CELL, 32.5 * CELL);
  }
}

class Game {
  get fusesTotal() { return this.objectives?.total ?? FUSES_TOTAL; }

  constructor() {
    this.cfg = CFG;
    this.online = null;              // OnlineController quando estiver numa partida cooperativa
    this.prefs = loadPrefs();
    this.state = 'title';
    this.mode = 'normal';            // 'normal' | 'hardcore' | 'online'
    this.time = 0;
    this.stats = { deaths: 0, repels: 0, start: 0 };
    this.debugOn = false;
    this.fear = 0;
    this._initRenderer();
    this.input = new Input(this.renderer.domElement);
    // perdeu o Pointer Lock (Esc, Alt+Tab, troca de aba): a simulacao para e o cursor fica livre no menu
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'playing' && !this.input.dragLook) this.pause('lock'); };
    this.input.onLockError = () => { this.hud?.toast('Este navegador não permite capturar o mouse: segure o botão esquerdo e arraste para olhar.', 6); };
    const focusLost = () => { this.input.clearState(); if (this.state === 'playing') this.pause('blur'); };
    addEventListener('blur', focusLost);
    document.addEventListener('visibilitychange', () => { if (document.hidden) focusLost(); });
    this.audio = new Audio(this);
    this._bindUI();
    window.__game = this;
    this.debug = { log: (m) => { if (this.debugOn) { this._dbgLog = [(this.time.toFixed(1) + ' ' + m), ...(this._dbgLog || [])].slice(0, 8); } } };
    requestAnimationFrame((t) => this._frame(t));
  }

  _initRenderer() {
    const q = QUALITY[this.prefs.quality] || QUALITY.medium;
    this.quality = q;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    $('stage').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010202);
    this.scene.fog = new THREE.FogExp2(0x020303, 0.055);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 70);
    this.scene.add(this.camera);
    this.ambient = new THREE.HemisphereLight(0x223038, 0x0a0806, 0.35);
    this.scene.add(this.ambient);
    this.ghostLight = new THREE.PointLight(0xa8c8ff, 0, 18, 1.5); this.scene.add(this.ghostLight);     // so acende para o espirito; existe desde o inicio para nao recompilar shaders
    this.post = new PostFX(r);
    this.post.setSize(innerWidth, innerHeight, q.scale);
    addEventListener('resize', () => {
      r.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.post.setSize(innerWidth, innerHeight, this.quality.scale);
    });
  }

  // ---------- carregamento ----------
  // Carrega o mundo uma unica vez (varias chamadas esperam a mesma promessa). silent: nao mexe nas telas (pre-carga no lobby)
  load(onProgress = null, silent = false) { return this._loadP || (this._loadP = this._load(onProgress, silent)); }

  async _load(onProgress, silent) {
    if (!silent) { this.state = 'loading'; $('title').hidden = true; $('loading').hidden = false; }
    const setMsg = (m) => { if (!silent) $('loadMsg').textContent = m; onProgress?.(m); };
    try {
      // modelos 3D opcionais (assets/models/manifest.json); sem eles o mundo usa os props de primitivas. Em ?debug, ?models=URL troca o manifesto (testes)
      const qs = new URLSearchParams(location.search);
      this.models = await loadModelLibrary(qs.has('debug') && qs.get('models') ? qs.get('models') : MODELS_MANIFEST);
      this.world = new World(this.scene, this.quality, setMsg, this.models);
      await this.world.build();
      this.grid = this.world.grid;
      this.lighting = this.world.lighting;
      setMsg('Modelo e movimentos da criatura');
      const [anims, guardian] = await Promise.all([
        loadCreatureAnims('assets/anim/creature.json'),
        loadGuardianAsset('assets/Character/monstrorigado.fbx'),
      ]);
      this.creatureModel = new CreatureModel(anims, this.world.M, this.world.T, guardian);
      this.creatureModel.setEnvironment(this.grid);
      this.scene.add(this.creatureModel.group);
      this.player = new Player(this);
      this.flashlight = new Flashlight(this, this.quality);
      this._makeLocalView();
      this.ai = new CreatureAI(this, this.creatureModel);
      this.director = new Director(this);
      this.objectives = new Objectives(this);
      this.objectives.buildPanel();
      this.particles = new Particles(this.scene, this.camera);
      this.fx = this.creatureFx = new CreatureFx(this.scene, this.particles.softTex);
      this.deathScene = new DeathScene(this);
      this.hud = new Hud(this);
      this.haunting = new Haunting(this);
      this.paranoia = new DarkParanoia(this);
      setMsg('Pronto');
      this.renderer.compile(this.scene, this.camera);
    } catch (e) {
      console.error(e);
      $('loadMsg').textContent = 'Falha ao carregar: ' + e.message + ' — rode o jogo por um servidor local (veja o LEIA-ME).';
      this._loadP = null;
      throw e;
    }
  }

  // mode 'normal': salva ao instalar fusivel (save proprio). 'hardcore': nunca le nem escreve save.
  async start(continueSave, mode = 'normal') {
    this.mode = mode;
    this.audio.init(this.prefs.volume);
    this.audio.reset();
    await this.load();
    const save = continueSave && mode === 'normal' ? loadSave() : null;
    if (mode === 'normal' && !continueSave) clearSave();      // "novo jogo" do Normal recomeca o save do Normal (o Hardcore nao tem save)
    this._applyModeUi();
    this.shuffleFuses(save?.fuseSeed);                      // fusiveis em lugares sorteados (o save guarda a semente: continuar mantem os lugares)
    this.player.spawn(this.world.playerStart.x, this.world.playerStart.z, this.world.playerStart.yaw);
    this.stats = { deaths: 0, repels: 0, start: 0 };
    this.haunting.reset(save?.haunting);
    this.paranoia.reset();
    if (save) this.applySave(save);
    else {
      this.hud.objective('A porta travou atrás de você. Restaure a energia: encontre os 5 fusíveis.', 9);
      setTimeout(() => this.hud.toast(`[${this.input.label('flashlight')}] lanterna · [Botão direito] foco · [${this.input.label('interact')}] interagir · [${this.input.label('objective')}] objetivo`, 7), 2500);
    }
    this.lastCheckpoint = this.makeSave();
    $('loading').hidden = true;
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.flashlight.on = true;
    this.grabMouse('start');
  }

  // Captura o mouse depois de uma acao do usuario. Se o navegador recusar (gesto expirado, Esc recente),
  // o jogo fica no menu e o proximo clique tenta de novo; nunca desiste do Pointer Lock sozinho.
  async grabMouse(reason = 'resume') {
    const ok = await this.input.requestLock();
    if (!ok && !this.input.dragLook && this.state === 'playing') this.pause(reason === 'start' ? 'gate' : 'lock');
    return ok;
  }

  // ---------- fusiveis sorteados (solo) ----------
  // Sorteia onde ficam os 5 fusiveis desta partida (semente nova, ou a do save) e move tudo no mundo. Online o servidor faz o sorteio.
  shuffleFuses(seed) {
    const w = this.world;
    this.fuseSeed = seed != null ? seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const spots = this._fuseSpots || (this._fuseSpots = collectFuseSpots(w));
    const drawers = w.drawers.map(d => ({ num: d.num, x: d.x, y: d.y, z: w.drawerBank.zf + 0.5 }));
    const ids = Array.from({ length: this.fusesTotal }, (_, i) => i + 1);
    const layout = pickFuseLayout(spots, drawers, ids, mulberry32(this.fuseSeed), { basementMax: 1 });
    w.placeFuses(layout.map(a => ({ id: a.id, x: a.spot.x, y: a.spot.y, z: a.spot.z, drawer: a.drawer })));
    this.fuseHints = fuseHints(layout, mulberry32(this.fuseSeed ^ 0x9e3779b9), 3);
  }
  // online: pistas do Livro de Ocorrencias a partir dos fusiveis que o servidor sorteou (todos leem as mesmas)
  setFuseHints(items) {
    const w = this.world, spots = this._fuseSpots || (this._fuseSpots = collectFuseSpots(w));
    const layout = items.map(it => ({ drawer: it.drawer, spot: it.drawer != null ? { room: 'Necrotério', kind: 'drawer' } : (spots.find(s => Math.hypot(s.x - it.x, s.z - it.z) < 0.08) || { room: 'prédio', kind: null }) }));
    let h = 7; for (const it of items) h = (Math.imul(h, 31) + Math.round(it.x * 100) + Math.round(it.z * 100)) | 0;
    this.fuseHints = fuseHints(layout, mulberry32(h >>> 0), 3);
  }

  // ---------- checkpoint ----------
  itemKey(it) { return it.type + ':' + (it.id ?? this.world.items.indexOf(it)); }
  makeSave() {
    const p = this.player;
    return {
      installed: [...this.objectives.installed],
      taken: this.world.items.filter(i => i.taken && i.type !== 'fuse').map(i => this.itemKey(i)),
      key: p.inventory.key, map: p.inventory.map,
      battery: this.flashlight.battery,
      deaths: this.stats.deaths, repels: this.stats.repels, time: this.time - (this.stats.start || 0),
      unlocked: this.world.doorsList.filter(d => d.kind === 'K' && !d.locked).length > 0,
      unjammed: this.world.doorsList.filter(d => d.kind === 'J' && !d.jammed).length > 0,
      creatureActive: this.ai.state !== 'dormant',
      opened: (this.world.drawers || []).filter(d => d.open > 0.5).map(d => d.num),
      haunting: this.haunting?.saveState(),
      fuseSeed: this.fuseSeed,
    };
  }
  checkpoint(reason) {
    if (this.mode !== 'normal') return;        // Hardcore (e online): nenhum checkpoint, nada em disco
    this.lastCheckpoint = this.makeSave();
    writeSave(this.lastCheckpoint);
    this.hud.toast('Progresso salvo.', 1.6);
  }
  applySave(s) {
    const w = this.world, p = this.player;
    this.haunting.reset(s.haunting);
    for (const id of s.installed) {
      const it = w.fuseItem(id);
      if (it) { it.taken = true; it.mesh.visible = false; }
      this.objectives.install(id, true);
    }
    if (s.installed.length) this.lighting.setPowered(SECTOR_ORDER.slice(0, s.installed.length), false);
    for (const k of s.taken) { const it = w.items.find(i => this.itemKey(i) === k); if (it) { it.taken = true; it.mesh.visible = false; } }
    p.inventory.key = s.key; p.inventory.map = s.map;
    this.flashlight.battery = Math.max(0.5, s.battery ?? 1);
    this.stats.deaths = s.deaths || 0; this.stats.repels = s.repels || 0;
    if (s.unlocked) w.doorsList.filter(d => d.kind === 'K').forEach(d => { d.locked = false; if (d.padlock) d.padlock.visible = false; });
    if (s.unjammed) w.doorsList.filter(d => d.kind === 'J').forEach(d => { d.jammed = false; if (d.bar) d.bar.visible = false; });
    if (s.creatureActive && this.ai.state === 'dormant') {
      const far = this.farthestVent(); this.ai.activate(this.world.creatureSpawn);
      if (far) this.ai.teleport(far.x, far.z, 'patrol');
    }
    this.player.spawn(w.checkpoint.x, w.checkpoint.z, w.checkpoint.yaw);
    const n = s.installed.length;
    this.hud.objective(n >= this.fusesTotal ? 'Puxe a alavanca do quadro geral.' : `Fusíveis: ${n}/${this.fusesTotal}. Encontre o resto.`, 6);
  }

  // ---------- host da IA da criatura ----------
  // A IA fala com o "host" (esta classe no solo; a sala no servidor). No solo o unico alvo e o jogador local.
  _makeLocalView() {
    const g = this, p = this.player, cam = this.camera, fl = this.flashlight;
    this.localView = {
      id: 0, local: true, fl,
      get pos() { return p.pos; }, get eye() { return cam.position; }, get hidden() { return p.hidden; },
      get holdingBreath() { return p.holdingBreath; }, get crouch() { return p.crouch; }, get sprinting() { return p.sprinting; },
      get dead() { return p.dead; },
    };
    this._targets = [this.localView];
  }
  targets() { return this._targets; }
  onBurnProgress(view, v) { this.hud?.burnMeter(v); }

  farthestVent(from = this.player.pos) {
    let best = null, bd = -1;
    for (const v of this.world.vents) { const d = Math.hypot(v.x - from.x, v.z - from.z); if (d > bd) { bd = d; best = v; } }
    return best;
  }

  // ---------- ruido ----------
  makeNoise(x, z, radius, kind, fromCreature = false) {
    if (this.online) { if (kind === 'clique') this.online.sendNoise('clique'); return; }
    if (fromCreature || !this.ai || radius <= 0) return;
    this.ai.hear(x, z, radius, kind);
  }

  zoneAtPos(x, z) {
    const g = this.grid; const cx = g.cellX(x), cy = g.cellY(z);
    let c = [cx, cy];
    if (g.isWallish(cx, cy)) c = g.quadCell(cx, cy, x - g.cx(cx) >= 0 ? 1 : -1, z - g.cz(cy) >= 0 ? 1 : -1) || c;
    return g.zoneCfg(c[0], c[1]);
  }

  // ---------- interacao ----------
  findInteractable() {
    const cam = this.camera, fwd = cam.getWorldDirection(new THREE.Vector3());
    let best = null, bs = Infinity;
    for (const it of this.world.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const p = it.pos();
      const v = p.clone().sub(cam.position);
      const d = v.length();
      if (d > 2.5 + (it.radius > 1 ? 0.4 : 0)) continue;
      v.normalize();
      const ang = Math.acos(clamp(v.dot(fwd), -1, 1));
      const allow = Math.atan2(it.radius, Math.max(0.3, d)) + 0.05;
      if (ang > allow) continue;
      const clear = this.grid.segmentClear(cam.position.x, cam.position.z, p.x, p.z, true, (b) => b.prop || (it.door && b.door === it.door) || (b.kind === 'drawers'));
      if (!clear) continue;
      const score = ang / allow + d * 0.15;
      if (score < bs) { bs = score; best = it; }
    }
    return best;
  }

  doorPrompt(d) {
    const p = this.player;
    if (d.kind === 'X') return this.objectives.doorOpen ? null : `Porta principal — trava sem energia (${this.objectives.installed.length}/${this.fusesTotal})`;
    if (d.locked) return p.inventory.key ? 'Destrancar com a chave do subsolo' : 'Trancada — precisa da chave do subsolo';
    if (d.jammed) return d.sideOf(p.pos.x, p.pos.z) > 0 ? 'Tirar o cano preso na maçaneta' : 'Emperrada — algo trava do outro lado';
    return d.isOpen() ? 'Fechar' : 'Abrir';
  }
  useDoor(d) {
    const p = this.player, pos = new THREE.Vector3(d.cx, d.base + 1, d.cz);
    if (d.kind === 'X') { this.audio.locked(pos); return; }
    if (this.online) { this.online.requestDoor(d); return; }
    if (d.locked) {
      if (!p.inventory.key) { this.audio.locked(pos); this.hud.toast('Trancada. "SUBSOLO — ACESSO RESTRITO".'); return; }
      d.locked = false; if (d.padlock) d.padlock.visible = false;
      this.audio.metalHit(pos, 0.4); this.hud.toast('Cadeado aberto.');
      this.makeNoise(d.cx, d.cz, 6, 'cadeado');
      return;
    }
    if (d.jammed) {
      if (d.sideOf(p.pos.x, p.pos.z) > 0) {
        d.jammed = false; if (d.bar) d.bar.visible = false;
        this.audio.metalHit(pos, 0.8); this.makeNoise(d.cx, d.cz, 9, 'cano');
        this.hud.toast('Você tirou o cano. Atalho aberto para o corredor.');
        d.setOpen(true, p.pos.x, p.pos.z);
      } else { this.audio.locked(pos); this.hud.toast('Emperrada. Algo trava a porta do outro lado.'); this.makeNoise(d.cx, d.cz, 5, 'porta'); }
      return;
    }
    const opening = !d.isOpen();
    const fast = p.sprinting;
    d.setOpen(opening, p.pos.x, p.pos.z, fast);
    if (opening) this.audio.doorOpen(pos, fast); else this.audio.doorClose(pos);
    this.makeNoise(d.cx, d.cz, fast ? NOISE.doorSlam : NOISE.door, 'porta');
  }

  itemPrompt(it) {
    return { fuse: 'Pegar fusível', battery: 'Pegar pilhas', key: 'Pegar a chave do subsolo', note: 'Ler documento' }[it.type];
  }
  takeItem(it) {
    if (this.online) { this.online.requestTake(it); return; }
    const p = this.player;
    it.taken = true; it.mesh.visible = false;
    this.audio.pickup(it.type);
    if (it.type === 'fuse') {
      p.inventory.fuses.push(it.id);
      this.makeNoise(p.pos.x, p.pos.z, NOISE.pickup, 'pegar');
      const left = this.fusesTotal - this.objectives.installed.length - p.inventory.fuses.length;
      this.hud.toast(left > 0 ? `Fusível de porcelana. Faltam ${left}. Leve ao quadro — se ele te pegar, você perde o que carrega.` : 'O último fusível. Volte ao quadro geral.', 5);
      if (this.ai.state === 'dormant') this.wakeCreature();
    } else if (it.type === 'battery') {
      this.flashlight.battery = Math.min(1, this.flashlight.battery + CFG.FLASHLIGHT.batteryPickup);
      this.hud.toast('Pilhas novas. Bateria da lanterna recarregada.');
    } else if (it.type === 'key') {
      p.inventory.key = true;
      this.hud.toast('Chave do subsolo. A porta fica no fim do corredor norte.', 4);
    } else if (it.type === 'note') {
      this.readNote(it.id);
    }
  }
  readNote(id) {
    this.state = 'reading';
    this.hud.openNote(id);
    this.input.exitLock();
  }
  closeNote() {
    this.hud.closeNote();
    this.state = 'playing';
    this.grabMouse();
  }
  takeMap(item) {
    item.taken = true; item.mesh.visible = false;
    this.player.inventory.map = true;
    this.audio.pickup('map');
    this.hud.toast(`Planta de evacuação. [${this.input.label('map')}] para consultar.`, 4);
  }
  openMap() {
    if (!this.player.inventory.map) { this.hud.toast('Você não tem uma planta do prédio. Há uma na parede da recepção.'); return; }
    const c = this.world.renderMapCanvas(1100, 760);
    const ctx = c.getContext('2d'), t = this.world.mapTransform;
    const px = t.ox + this.player.pos.x / CELL * t.s, pz = t.oy + this.player.pos.z / CELL * t.s;
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-this.player.yaw + Math.PI);
    ctx.fillStyle = '#e8d27a'; ctx.beginPath(); ctx.moveTo(0, -t.s * 1.1); ctx.lineTo(t.s * 0.7, t.s * 0.7); ctx.lineTo(-t.s * 0.7, t.s * 0.7); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e8d27a'; ctx.font = '600 15px "Barlow Condensed", sans-serif'; ctx.fillText('VOCÊ', px + t.s, pz - t.s);
    const ps = this.world.panelSpec; ctx.fillStyle = '#6fe08a'; ctx.fillRect(t.ox + ps.x * t.s, t.oy + ps.y * t.s, t.s, t.s);
    ctx.fillText('QUADRO GERAL', t.ox + ps.x * t.s - 20, t.oy + ps.y * t.s + t.s * 2.6);
    this.state = 'map';
    this.hud.openMap(c);
    this.input.exitLock();
  }
  closeMap() { this.hud.closeMap(); this.state = 'playing'; this.grabMouse(); }

  hidePrompt(spot) {
    if (this.player.hidden === spot) return spot.type === 'locker' ? 'Sair do armário' : 'Sair de baixo';
    return spot.type === 'locker' ? 'Esconder no armário' : (spot.res?.d > 1.9 && spot.clearance > 0.7 ? 'Esconder embaixo da maca' : 'Esconder embaixo da cama');
  }
  toggleHide(spot) {
    if (this.online) { this.online.requestHide(spot, !this.player.hidden); return; }
    const p = this.player, ai = this.ai;
    const pos = new THREE.Vector3(spot.x, spot.base + 1, spot.z);
    if (p.hidden) {
      p.exitHide();
      spot.compromised = false;
      if (spot.type === 'locker') { spot.target = 1; setTimeout(() => { spot.target = 0; }, 450); this.audio.lockerMove(pos); }
      this.makeNoise(spot.x, spot.z, spot.type === 'locker' ? NOISE.locker : 2, 'esconderijo');
      this.post.uniforms.hideMask.value = 0;
      return;
    }
    // visto entrando? entao o esconderijo nao serve
    const seen = ai.state !== 'dormant' && (ai.sees || (ai.state === 'chase' && ai.lastSeenT < 1.2 && ai.distToPlayer() < 8));
    spot.compromised = seen && ['chase', 'stalk'].includes(ai.state);
    p.enterHide(spot);
    if (spot.type === 'locker') { spot.target = 1; setTimeout(() => { spot.target = 0; }, 350); this.audio.lockerMove(pos); }
    this.makeNoise(spot.x, spot.z, spot.type === 'locker' ? NOISE.locker : 2, 'esconderijo');
    this.post.uniforms.hideMask.value = spot.type === 'locker' ? 1 : 0.3;
    this.stats.hides = (this.stats.hides || 0) + 1;
  }
  // cooperativo: o servidor aceitou entrar/sair do esconderijo; aqui so o lado visual/sonoro
  applyHide(spot, on, pose = null) {
    const p = this.player, pos = new THREE.Vector3(spot.x, spot.base + 1, spot.z);
    if (on) {
      p.enterHide(spot);
      if (spot.type === 'locker') { spot.target = 1; setTimeout(() => { spot.target = 0; }, 350); this.audio.lockerMove(pos); }
      this.post.uniforms.hideMask.value = spot.type === 'locker' ? 1 : 0.3;
      this.stats.hides = (this.stats.hides || 0) + 1;
    } else {
      p.exitHide();
      if (pose) { p.pos.set(pose.x, pose.y, pose.z); p.yaw = pose.yaw ?? p.yaw; }
      if (spot.type === 'locker') { spot.target = 1; setTimeout(() => { spot.target = 0; }, 450); this.audio.lockerMove(pos); }
      this.post.uniforms.hideMask.value = 0;
    }
  }

  forceUnhide() {
    const p = this.player;
    if (!p.hidden) return;
    const spot = p.hidden;
    p.exitHide();
    spot.compromised = false;
    this.post.uniforms.hideMask.value = 0;
  }

  drawerPrompt(d) { return (d.open > 0.5 ? 'Fechar' : 'Abrir') + ` gaveta ${d.num}`; }
  toggleDrawer(d) {
    if (this.online) { this.online.requestDrawer(d); return; }
    const w = this.world;
    const open = d.target < 0.5;
    w.drawerMesh(d);
    d.target = open ? 1 : 0;
    const pos = new THREE.Vector3(d.x, d.y, w.drawerBank.zf + 0.3);
    this.audio.drawer(pos);
    this.makeNoise(d.x, w.drawerBank.zf + 0.5, NOISE.drawer, 'gaveta');
    if (open && d.content === 'cadaver' && Math.random() < 0.3) this.audio.whisper(pos);
  }

  // ---------- criatura ----------
  wakeCreature() {
    const spawn = this.world.creatureSpawn;
    this.ai.activate(spawn);
    // todas as luzes engasgam e um estrondo vem do necroterio
    for (const l of this.lighting.lamps) l.startup = range(0.4, 1.4);
    this.audio.doorSlam({ x: spawn.x, y: 1, z: spawn.z }, 1);
    this.player.shake = 0.6;
    setTimeout(() => this.hud.objective('Algo acordou. Não deixe que ele te veja no escuro.', 6), 2500);
  }
  onCaught(ai, fromHide) {
    this.state = 'dying';
    this.player.lookLock = ai.m.headWorld(new THREE.Vector3());     // trava o movimento; a camera e da cena de morte
    this.hud.prompt(null);
    this.player.shake = 1.2;
    this.deathScene.start(ai, { fromHide });
  }
  playerDies() {
    this.audio.death();
    this.creatureFx.clear();
    this.stats.deaths++;
    this._deathT = 0;
  }
  respawn() {
    if (this.online) { this.online.becomeSpectator(); return; }
    if (this.mode === 'hardcore') { this.restartRun(); return; }
    this.audio.reset();
    const s = this.lastCheckpoint;
    this.haunting.interrupt();
    this.paranoia.reset();
    const w = this.world, p = this.player;
    // fusiveis carregados voltam para onde estavam
    for (const id of p.inventory.fuses) {
      const it = w.fuseItem(id);
      if (it) { it.taken = false; it.mesh.visible = true; }
    }
    p.inventory.fuses = [];
    // carga interrompida
    const o = this.objectives;
    if (o.charging) {
      o.charging = false; o.charge = 0; o.leverPivot.rotation.x = 0.9;
      this.audio.stopSiren(); this.lighting.setBlackout(false);
      this.director.finale = false; this.ai.enraged = false;
      o.sockets.forEach(sk => sk.lamp.material.color.set(0x38ff5a));
    }
    p.spawn(w.checkpoint.x, w.checkpoint.z, w.checkpoint.yaw);
    p.dead = false; p.lookLock = null;
    this.deathScene.reset();
    this.flashlight.battery = Math.max(this.flashlight.battery, 0.55);
    this.flashlight.heat = 0; this.flashlight.overheat = 0; this.flashlight.on = true;
    const far = this.farthestVent();
    this.ai.reset(); this.creatureFx.clear(); this.ai.m.cancelFlinch();
    if (far) this.ai.teleport(far.x, far.z, 'lurk'); this.ai.lurkTime = 12;
    this.ai._killed = false;
    this.director.menace = 0; this.director.breather = 20;
    this.post.uniforms.pulse.value = 0; this.post.uniforms.fade.value = 0; this.post.uniforms.hideMask.value = 0;
    $('death').hidden = true;
    this.state = 'playing';
    this.grabMouse();
    this.hud.objective(`De volta ao quadro geral. Fusíveis instalados: ${o.installed.length}/${this.fusesTotal}.`, 5);
  }

  // Hardcore: a tentativa morreu. Tudo volta ao estado inicial da partida (fusiveis, quadro, luzes, portas, criatura).
  restartRun() {
    const w = this.world, p = this.player, o = this.objectives, u = this.post.uniforms;
    this.audio.reset();
    w.resetState();
    this.shuffleFuses();                                    // Hardcore recomeca do zero: fusiveis em outros lugares
    o.reset();
    this.audio.stopSiren();
    this.particles.reset(); this.creatureFx.clear();
    p.inventory = { fuses: [], key: false, map: false };
    p.spawn(w.playerStart.x, w.playerStart.z, w.playerStart.yaw);
    p.dead = false; p.lookLock = null; p.shake = 0; p.holdingBreath = false; p.gasped = false;
    this.deathScene.reset();
    const fl = this.flashlight;
    fl.battery = CFG.FLASHLIGHT.battery; fl.heat = 0; fl.overheat = 0; fl.focus = 0; fl.on = true; fl.shakeBoost = 0;
    this.ai.hardReset();
    this.director = new Director(this);
    this.freezeAI = false; this.fear = 0; this.creatureNear = 0; this._deathT = undefined;
    this.haunting.reset(); this.paranoia.reset();
    this.stats = { deaths: this.stats.deaths, repels: 0, start: this.time };
    u.pulse.value = 0; u.fade.value = 0; u.hideMask.value = 0; u.adapt.value = 0; u.burn.value = 0;
    this.ambient.intensity = 0.35;
    this.lastCheckpoint = null;
    $('death').hidden = true;
    this.hud.objective('Hardcore: tudo recomeçou. A porta travou atrás de você — encontre os 5 fusíveis.', 8);
    this.state = 'playing';
    this.grabMouse();
  }

  // textos que dependem do modo
  _applyModeUi() {
    const hard = this.mode === 'hardcore';
    if (this.mode === 'online') { $('pauseInfo').textContent = 'Online: o jogo NÃO pausa para ninguém. Volte logo — os outros continuam na partida.'; $('btnRetry').textContent = 'Assistir como espírito'; return; }
    $('pauseInfo').textContent = hard ? 'Hardcore: não há checkpoints. Se ele te pegar, tudo recomeça do zero — o seu save do Normal fica intacto.'
      : 'Fusíveis no bolso se perdem se você morrer. Instalar no quadro salva o progresso.';
    $('btnRetry').textContent = hard ? 'Recomeçar do zero' : 'Tentar de novo';
  }

  // cooperativo: a criatura estourou a lampada (o servidor avisou); so o lado visual/sonoro
  burstLampVisual(lamp) {
    lamp.state = 'dead';
    this.lighting.computeLightMap();
    this.particles.sparks(new THREE.Vector3(lamp.x, lamp.y - 0.1, lamp.z));
    this.audio.lampBurst({ x: lamp.x, y: lamp.y, z: lamp.z });
  }
  // cooperativo: a criatura acordou (primeiro fusivel pego por alguem)
  wakeCreatureFx(spawn) {
    for (const l of this.lighting.lamps) l.startup = range(0.4, 1.4);
    this.audio.doorSlam(spawn, 1);
    this.player.shake = 0.6;
    setTimeout(() => this.hud.objective('Algo acordou. Não deixe que ele te veja no escuro.', 6), 2500);
  }

  burstLamp(lamp) {
    lamp.state = 'dead';
    this.lighting.computeLightMap();
    this.particles.sparks(new THREE.Vector3(lamp.x, lamp.y - 0.1, lamp.z));
    this.audio.lampBurst({ x: lamp.x, y: lamp.y, z: lamp.z });
    this.audio.creatureCry(this.ai.pos, 'hiss');
  }

  // ---------- telas ----------
  pause(reason = 'menu') {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.clearState();
    const gate = reason === 'gate';
    $('pauseTitle').textContent = gate ? 'Pronto?' : this.online ? 'Menu' : 'Pausado';
    $('pauseHint').textContent = gate ? 'Clique em Voltar (ou fora do menu) para capturar o mouse e começar.'
      : reason === 'blur' ? 'A janela perdeu o foco. Clique em Voltar (ou fora do menu) para retomar.' : '';
    $('pause').hidden = false;
    if (!this.online) this.audio.suspend();      // cooperativo: o jogo (e a voz) continua enquanto voce esta no menu
  }
  // Volta ao jogo. So sai da pausa se o mouse for realmente capturado (ou se o navegador so oferece o modo arrastar).
  async resume() {
    if (this.state !== 'paused' || this._resuming) return;
    this._resuming = true;
    try {
      const ok = await this.input.requestLock();
      if (this.state !== 'paused') return;
      if (!ok && !this.input.dragLook) { $('pauseHint').textContent = 'Não consegui capturar o mouse ainda. Clique em Voltar de novo.'; return; }
      $('pause').hidden = true;
      this.state = 'playing';
      this.audio.resume();
    } finally { this._resuming = false; }
  }

  win() {
    this.state = 'won';
    this.input.exitLock();
    const t = this.time - (this.stats.start || 0);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60).toString().padStart(2, '0');
    $('winStats').innerHTML = `<div><dt>Tempo</dt><dd>${mm}:${ss}</dd></div><div><dt>Mortes</dt><dd>${this.stats.deaths}</dd></div><div><dt>Vezes que você o queimou</dt><dd>${this.stats.repels}</dd></div>`;
    setTimeout(() => { $('win').hidden = false; this.hud.show(false); }, 2200);
    if (this.mode === 'normal') clearSave();
  }

  _bindUI() {
    this.binds = new BindsUI(this.input, () => this.online?.voiceKeysChanged?.());       // menu "Teclas" e dicas com as teclas atuais
    const hasSave = !!loadSave();
    $('btnContinue').hidden = !hasSave;
    $('btnStart').onclick = () => this.start(false, 'normal');
    $('btnHardcore').onclick = () => this.start(false, 'hardcore');
    $('btnOnline').onclick = () => (this.onlineCtl ||= new OnlineController(this)).openMenu();
    // recarregou a pagina no meio de uma sala/partida: o servidor guarda o personagem por um tempo e este botao volta a ele
    try { $('btnResumeOnline').hidden = !sessionStorage.getItem('apagao.session.v1'); } catch { /* sem storage */ }
    $('btnResumeOnline').onclick = $('btnOnline').onclick;
    $('btnContinue').onclick = () => this.start(true, 'normal');
    $('btnResume').onclick = () => this.resume();
    $('pause').addEventListener('click', (e) => { if (e.target === $('pause')) this.resume(); });
    $('btnRetry').onclick = () => this.respawn();
    $('btnNoteClose').onclick = () => this.closeNote();
    $('btnMapClose').onclick = () => this.closeMap();
    $('btnAgain').onclick = () => { if (this.mode === 'normal') clearSave(); location.reload(); };
    $('btnQuit').onclick = () => { if (this.online && !this.online.confirmLeave()) return; this.online?.leaveRoom(); location.reload(); };
    const sens = $('optSens'), vol = $('optVol'), qual = $('optQuality'), inv = $('optInvert');
    sens.value = this.prefs.sens; vol.value = this.prefs.volume; qual.value = this.prefs.quality; inv.checked = !!this.prefs.invertY;
    const saveP = () => {
      this.prefs.sens = +sens.value; this.prefs.volume = +vol.value; this.prefs.invertY = inv.checked;
      const q = qual.value;
      if (q !== this.prefs.quality) {
        this.prefs.quality = q; this.quality = QUALITY[q];
        this.post.setSize(innerWidth, innerHeight, this.quality.scale);
        if (this.flashlight) { const s = this.flashlight.spot.shadow; s.mapSize.set(this.quality.shadow, this.quality.shadow); s.map?.dispose(); s.map = null; }
      }
      this.audio.setVolume(this.prefs.volume);
      savePrefs(this.prefs);
    };
    for (const el of [sens, vol, qual, inv]) el.addEventListener('input', saveP);
    this.renderer.domElement.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.requestLock(); });
  }

  // ---------- laco principal ----------
  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    if (!this.world || !this.player) { this.input.endFrame(); return; }
    const inp = this.input;

    // teclas globais
    if (this.state === 'reading' && (inp.actHit('interact') || inp.hit('Escape') || inp.actHit('breath'))) this.closeNote();
    else if (this.state === 'map' && (inp.actHit('map') || inp.hit('Escape') || inp.actHit('objective'))) this.closeMap();
    else if (this.state === 'paused' && inp.hit('Escape')) this.resume();
    if (inp.hit('F3')) { this.debugOn = !this.debugOn; $('debug').hidden = !this.debugOn; }

    // cooperativo: o mundo e compartilhado e nao pausa por menu, nota ou mapa (so os controles locais param)
    const overlay = this.online && (this.state === 'paused' || this.state === 'reading' || this.state === 'map' || this.state === 'dead' || this.state === 'ended');
    const active = this.state === 'playing' || this.state === 'dying' || overlay;
    if (this.state === 'playing' || overlay) this.time += dt;
    if (active) this._update(dt, inp);
    else if (this.state === 'won') { this.time += dt; this.post.uniforms.fade.value = Math.min(1, this.post.uniforms.fade.value + dt * 0.5); this.post.uniforms.fadeColor.value.setRGB(0.7, 0.72, 0.7); }
    if (!active) {
      this.haunting?.update(0);
      this.paranoia?.update(0);
      this.audio.library?.update(dt, { fear: 0, monsterDist: Infinity });
    }

    this.post.render(this.scene, this.camera, this.time);
    inp.endFrame();
  }

  _update(dt, inp) {
    const p = this.player, fl = this.flashlight, ai = this.ai;
    const playing = this.state === 'playing';
    if (this.online) this.online.update(dt);
    // ---------- entrada de jogo ----------
    if (playing) {
      if (inp.actHit('objective')) this.hud.objective(this.currentObjective(), 5);
      if (inp.actHit('map')) { this.openMap(); return; }
      if (inp.hit('Escape') && this.input.dragLook) { this.pause(); return; }
    }
    p.update(dt, playing ? inp : { mouse: { dx: 0, dy: 0 }, down: () => false, hit: () => false, act: () => false, actHit: () => false, actUp: () => false });
    fl.update(dt, inp, !playing || !!p.hidden || p.ghost);
    if (p.hidden) fl.on = fl.on && p.hidden.type !== 'locker' ? fl.on : fl.on;

    // interacao
    let target = null;
    if (playing && p.ghost) this.hud.prompt(null);
    else if (playing) {
      if (p.hidden) {
        this.hud.prompt(this.hidePrompt(p.hidden), inp.label('interact'));
        if (inp.actHit('interact')) this.toggleHide(p.hidden);
      } else {
        target = this.findInteractable();
        const text = target ? target.prompt(this) : null;
        this.hud.prompt(text, target?.hold?.() ? 'Segure ' + inp.label('interact') : inp.label('interact'));
        if (target && inp.actHit('interact') && !(target.hold && target.hold())) target.use(this);
        this.objectives.holdUpdate(dt, target?.kind === 'panel' && inp.act('interact'));
      }
    } else this.hud.prompt(null);

    this.objectives.update(dt);
    const cdt = this.state === 'dying' ? dt * this.deathScene.timeScale : dt;      // congelada curta no agarrao da morte (so a criatura)
    ai.update(cdt);
    ai.visibleModel = ai.m.group.visible;
    this.deathScene.update(dt);                                                    // camera, pose e efeitos da morte (depois da IA, antes do modelo)
    if (ai.state !== 'dormant') ai.m.update(cdt, ai.pos.y, this.time);
    this.creatureFx.update(dt, ai.burning && ai.visibleModel, ai.m, this.audio);
    this.director.update(dt);
    this.world.update(dt);

    // medo: distancia e estado da criatura
    let fear = 0, near = 0;
    if (ai.state !== 'dormant' && ai.visibleModel) {
      const d = ai.distToPlayer();
      const same = Math.abs(ai.pos.y - p.pos.y) < 2.5;
      if (same) {
        near = clamp(1 - d / 9, 0, 1);
        if (ai.state === 'chase') fear = 0.55 + clamp(1 - d / 20, 0, 1) * 0.45;
        else if (ai.state === 'stalk' || ai.state === 'hesitate' || ai.state === 'inspect') fear = 0.45 + near * 0.4;
        else fear = near * 0.55 + (ai.m.eyeshine > 0.2 ? 0.25 : 0);
      }
    }
    if (this.objectives.charging) fear = Math.max(fear, 0.35);
    this.fear = damp(this.fear, fear, fear > this.fear ? 3 : 0.6, dt);
    this.creatureNear = near;
    const u = this.post.uniforms;
    u.fear.value = this.fear;
    u.pulse.value = this.state === 'dying' ? Math.min(1, u.pulse.value + dt) : damp(u.pulse.value, 0, 3, dt);
    u.burn.value = damp(u.burn.value, fl.focus * (fl.on ? 1 : 0) * 0.3 + (ai.m.burnGlow || 0) * 0.5, 8, dt);
    // escondido no armario os olhos se acostumam ao escuro (so visual; nao muda deteccao)
    u.adapt.value = damp(u.adapt.value, p.hidden?.type === 'locker' ? 1 : 0, p.hidden ? 0.6 : 4, dt);
    this.deathScene.applyFx(u);                                                    // morte: pulso, pancada, tunel, clarao e fade (por ultimo)
    this.lighting.update(dt, this.time, this.camera.position, ai.state !== 'dormant' && ai.visibleModel ? ai.pos : null);
    this.haunting.update(dt);
    this.paranoia.update(dt);
    u.paranoia.value = this.paranoia.strength;
    // espirito: visao noturna de verdade (ambiente levantado + um brilho frio colado na camera + neblina mais rala) para ler as salas escuras
    const sp = p.ghost ? 1 : 0;
    this.ambient.intensity = p.ghost ? 0.8 : this.lighting.blackout ? 0.22 : 0.35;
    this.ghostLight.intensity = sp * 5; this.ghostLight.position.copy(this.camera.position);
    this.scene.fog.density = sp ? 0.028 : 0.055;
    this.particles.update(dt, this.time, fl);
    this.audio.update(dt, { zone: this.zoneAtPos(p.pos.x, p.pos.z), fear: this.fear, blackout: this.lighting.blackout, nearExit: this.objectives.doorOpen,
      monsterDist: this.monsterDistance(), heartOn: this.state === 'playing' && !p.dead });
    this.hud.update(dt);

    // itens brilham quando a lanterna os ilumina
    for (const it of this.world.items) {
      if (it.taken) continue;
      const wp = it.mesh.getWorldPosition(new THREE.Vector3());
      const d = wp.distanceTo(this.camera.position);
      const k = d < 9 ? fl.illum(wp) : 0;
      it.glint.material.opacity = damp(it.glint.material.opacity, k > 0.05 ? 0.35 + 0.35 * Math.sin(this.time * 6 + wp.x) : 0, 8, dt);
    }

    // morte
    if (this.state === 'dying') {
      p.lookLock = ai.m.headWorld(new THREE.Vector3());
      if (this._deathT !== undefined) {                       // o jogador ja morreu (som do 2o estouro tocou); a tela de morte espera a cena acabar
        this._deathT += dt;
        const scene = this.deathScene, fallback = !scene.running;          // sem cena (nao deveria acontecer): escurece como antes
        if (fallback) { u.fade.value = clamp(this._deathT / 1.1, 0, 1); u.fadeColor.value.setRGB(0, 0, 0); }
        if ((scene.done || (fallback && this._deathT > 1.3)) && $('death').hidden) {
          $('death').hidden = false;
          $('deathTip').textContent = this.deathTip();
          this.input.exitLock();
          this._deathT = undefined;
          this.state = 'dead';
        }
      }
    }

    // saida
    if (this.objectives.doorOpen && this.state === 'playing' && !this.online) {      // online: quem valida a saida e o servidor
      const e = this.world.exitTrigger;
      if (p.pos.z > e.z - 0.5) this.win();
    }

    if (this.debugOn) this._debugPanel();
  }

  // distancia (m) entre o jogador e a criatura para o batimento; Infinity = sem batimento
  // (criatura dormindo, viajando pelos dutos ou em outro andar)
  monsterDistance() {
    const ai = this.ai, p = this.player;
    if (!ai || ai.state === 'dormant' || (ai.state === 'vent' && ai.sub === 'travel')) return Infinity;
    if (Math.abs(ai.pos.y - p.pos.y) > CFG.HEARTBEAT.floorGap) return Infinity;
    return Math.hypot(ai.pos.x - p.pos.x, ai.pos.z - p.pos.z);
  }

  currentObjective() {
    const o = this.objectives, p = this.player;
    if (o.doorOpen) return 'SAIA!';
    if (o.charging) return `Sobreviva até a porta destravar (${Math.floor(o.charge * 100)}%).`;
    if (o.installed.length >= this.fusesTotal) return this.online ? 'SAIA! A porta principal está aberta.' : 'Puxe a alavanca do quadro geral (segure E).';
    const carried = p.inventory.fuses.length;
    return `Fusíveis: ${o.installed.length}/${this.fusesTotal} instalados${carried ? `, ${carried} no bolso — leve ao quadro geral na recepção` : ''}.` + (p.inventory.key ? '' : ' Há áreas trancadas no subsolo.');
  }

  deathTip() {
    if (this.online) return 'Você agora é um espírito. Os vivos não veem você — exceto por um instante, de tempos em tempos. Fusíveis que você carregava caíram onde você morreu.';
    const tips = [
      'Luz forte nos OLHOS dele (segure o botão direito) o faz recuar. No corpo, só o enfurece.',
      'Se ele te viu entrando no esconderijo, não adianta. Quebre a linha de visão antes de se esconder.',
      'Quando ele parar na frente do seu esconderijo, segure ESPAÇO para prender a respiração.',
      'Correr e abrir portas correndo fazem barulho. Agachado (C) você quase não é ouvido.',
      'No escuro ele é mais rápido que você. Nas áreas iluminadas ele hesita.',
      'Fusíveis no bolso se perdem quando você morre. Instale-os assim que puder.',
      'O foco da lanterna superaquece. Solte o botão antes que ela apague sozinha.',
      'Ouça os dutos de ventilação: é por onde ele muda de andar.',
    ];
    if (this.mode === 'hardcore') return 'Hardcore: nada foi salvo. Fusíveis, quadro de energia e luzes voltam ao início. ' + tips[this.stats.deaths % tips.length];
    return tips[this.stats.deaths % tips.length];
  }

  _debugPanel() {
    const ai = this.ai, p = this.player;
    const L = this.lighting.lightAt(p.pos.x, p.pos.z);
    $('debug').textContent = [
      `fps ${(1 / Math.max(1e-3, this._fpsDt = damp(this._fpsDt || 0.016, (performance.now() - (this._lastDbg || performance.now())) / 1000, 5, 1))).toFixed(0)}`,
      `jogador (${(p.pos.x / CELL).toFixed(1)}, ${(p.pos.z / CELL).toFixed(1)}) y ${p.pos.y.toFixed(2)} luz ${L.toFixed(2)}`,
      `criatura ${ai.state}${ai.sub ? '/' + ai.sub : ''} medidor ${ai.meter.toFixed(2)} exp ${ai.exposure.toFixed(2)} hab ${ai.habit} d ${ai.distToPlayer().toFixed(1)}`,
      `diretor tensao ${this.director.menace.toFixed(2)} respiro ${this.director.breather.toFixed(0)} agress ${this.director.aggression().toFixed(2)}`,
      `lanterna bat ${(this.flashlight.battery * 100).toFixed(0)}% calor ${(this.flashlight.heat * 100).toFixed(0)}% foco ${this.flashlight.focus.toFixed(2)}`,
      `draw calls ${this.renderer.info.render.calls} tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k`,
      ...(this._dbgLog || []),
    ].join('\n');
    this._lastDbg = performance.now();
  }
}

const game = new Game();
// aviso deixado por uma sessao online que terminou de forma inesperada (servidor reiniciou, conexao perdida...)
try {
  const notice = sessionStorage.getItem('apagao.notice.v1');
  if (notice) {
    sessionStorage.removeItem('apagao.notice.v1');
    const b = $('netBanner'); b.textContent = notice; b.className = 'err'; b.hidden = false;
    setTimeout(() => { b.hidden = true; }, 12000);
  }
} catch { /* sem storage */ }
const params = new URLSearchParams(location.search);
if (params.has('debug') && params.has('audioqa')) import('../tools/audio/browser-qa.js').then(m => m.install(game)).catch(() => console.warn('QA de audio: ferramenta indisponivel neste build (so existe na pasta do projeto).'));
if (params.has('debug') && params.has('hauntqa')) import('../tools/haunting-qa.js').then(m => m.install(game)).catch(() => console.warn('QA de presencas indisponivel neste build.'));
if (params.has('debug') && params.has('guardianqa')) import('../tools/guardian-qa.js').then(m => m.install(game)).catch(() => console.warn('QA do Guardiao indisponivel neste build.'));
if (params.has('debug') && params.has('skinwalkerqa')) import('../tools/skinwalker-qa.js').then(m => m.install(game)).catch(() => console.warn('QA da criatura indisponivel neste build.'));
if (params.has('debug')) {
  import('./debug.js').then(async (m) => {
    m.installDebug(game);
    if (params.has('autostart')) await game.start(false);
  });
}
