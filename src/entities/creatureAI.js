// IA da criatura: maquina de estados com percepcao (visao, audicao, luz),
// reacao a lanterna, uso de dutos, checagem de esconderijos e ataque.
//
// Estados: dormant, patrol, investigate, stalk, chase, search, inspect,
//          stunned, flee, lurk, vent, hesitate, attack
//
// A IA nao conhece o jogo inteiro: fala com um "host" (o Game no solo, a sala no servidor multiplayer).
// Alvos: host.targets() devolve as "visoes de jogador" { id, pos, eye, hidden, holdingBreath, crouch, sprinting, dead, fl }.
// No solo e uma so (o jogador local) e tudo se comporta exatamente como antes; no cooperativo a criatura
// escolhe entre os jogadores vivos (this.tgt), mas os parametros e comportamentos sao os mesmos.
import * as THREE from 'three';
import { CREATURE as C, FLASHLIGHT as F, CELL } from '../config.js';
import { clamp, damp, angleDiff, range, pick } from '../core/rng.js';
import { sampleCreatureClearance, projectBodyOutOfObstacles, pointBoxSignedDistance, sweepCircleAgainstBox } from '../shared/creature-clearance.js';
import { skinwalkerWaypoint } from './skinwalker-navigation.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const LOCOMOTION = new Set(['walk', 'limp', 'stalk', 'run', 'crawl', 'creep']);
const SLOW_WALK = 'creep';      // marcha lenta de patrulha (Kimodo: passos normais; o clipe 'limp' arrastava a perna)

export class CreatureAI {
  constructor(game, model) {
    this.game = game; this.m = model; this.grid = game.grid;
    model.setEnvironment?.(this.grid);
    this.skinwalker = model.profile?.profile === 'skinwalker' || model.anim?.profile?.profile === 'skinwalker';
    this.clearance = {bodyRadius:C.bodyRadius,headRadius:C.headRadius}; this._collisionPosition = null;
    model.afterPose = () => this.reconcilePose();
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.state = 'dormant'; this.stateT = 0; this.sub = null;
    this.path = []; this.pathI = 0; this.repathT = 0; this.goal = null;
    this.meter = 0; this.sees = false;
    this.lastSeen = new THREE.Vector3(); this.lastSeenT = 99; this.knowT = 0;
    this.exposure = 0; this.habit = 0; this.enrage = 0; this.shield = 0;
    this.moveSpeed = 0; this.aggr = 1; this.enraged = false;
    this.checked = new Set(); this.inspectSpot = null; this.noHold = 0;
    this.bash = 0; this.bashDoor = null;
    this.vent = null; this.burstCD = 0; this.pauseT = 0;
    this.visibleModel = false; this.burning = false;
    this.voiceT = 3;
    this.tgt = null;                 // jogador em foco (visao de jogador)
    this.m.group.visible = false;
  }

  // ---------- utilidades ----------
  get level() { return this.pos.y < -1.5 ? -1 : 0; }
  levelOf(p) { return p.y < -1.5 ? -1 : 0; }
  cell() { return [this.grid.cellX(this.pos.x), this.grid.cellY(this.pos.z)]; }
  lightHere() { const [x, y] = this.cell(); return this.grid.inb(x, y) ? this.grid.light[this.grid.idx(x, y)] : 0; }
  // ---------- alvos (um jogador no solo; ate 4 no cooperativo) ----------
  aliveViews() {
    const a = this._av || (this._av = []);
    a.length = 0;
    for (const v of this.game.targets()) if (!v.dead) a.push(v);
    return a;
  }
  nearestView(from = this.pos) {
    let best = null, bd = Infinity;
    for (const v of this.aliveViews()) { const d = Math.hypot(v.pos.x - from.x, v.pos.z - from.z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  // alvo atual (se morreu ou saiu, passa para o mais proximo)
  currentTarget() {
    if (!this.tgt || this.tgt.dead) this.tgt = this.nearestView();
    return this.tgt;
  }
  distToPlayer() { const p = this.tgt && !this.tgt.dead ? this.tgt : this.nearestView(); return p ? Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) : Infinity; }
  occupantOf(spot) { for (const v of this.game.targets()) if (v.hidden === spot) return v; return null; }
  lookAtPos() { const p = this.currentTarget(); return p ? p.eye : null; }
  // encara o jogador (olhar fixo, cabeca erguida) quando esta no mesmo andar e a ate C.stare.range; nao no meio de farejar, cambalear ou no duto
  staresAt() {
    if (!C.stare?.on || ['dormant', 'inspect', 'stunned', 'vent'].includes(this.state)) return false;
    const p = this.currentTarget();
    return !!p && this.levelOf(p.pos) === this.level && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < C.stare.range;
  }

  setState(s, sub = null) {
    if(s==='vent'||this.state==='vent')this._collisionPosition=null;
    this.state = s; this.stateT = 0; this.sub = sub;
    this.path = []; this.pathI = 0; this.repathT = 0;
    this.game.debug?.log('criatura: ' + s + (sub ? ' (' + sub + ')' : ''));
  }

  activate(spawn) {
    this._collisionPosition=null;
    this.pos.set(spawn.x, this.grid.floorY(spawn.x, spawn.z), spawn.z);
    this.yaw = Math.PI;
    this.m.group.visible = true;
    this.setState('patrol');
    this.pauseT = 0;
    // primeira caminhada passa pelo corredor norte, a vista da recepcao
    this.goal = new THREE.Vector3(this.grid.cx(25), 0, this.grid.cz(10));
    this.firstWalk = true;
    this.m.play('roar', 0.1, { restart: true });
    this.stateT = -2.2;   // espera o grito terminar
    this.game.audio?.creatureCry(this.pos, 'roar');
  }

  teleport(x, z, state = 'lurk') {
    this._collisionPosition=null;
    this.pos.set(x, this.grid.floorY(x, z), z);
    this.setState(state);
    this.meter = 0; this.knowT = 0; this.exposure = 0;
  }

  // ---------- percepcao ----------
  // Cada jogador vivo e avaliado do mesmo jeito de antes; o medidor sobe pelo que mais chama a atencao (nunca soma)
  // e so decai quando NENHUM jogador esta sendo visto.
  // direcao do olhar: o corpo, mais o giro da cabeca em direcao a quem ela ja notou (ate ~57 graus)
  gazeYaw(toT) {
    const aware = ['stalk', 'chase', 'hesitate', 'attack'].includes(this.state) || this.meter > 0.15;
    return aware ? this.yaw + clamp(angleDiff(this.yaw, toT), -1.0, 1.0) : this.yaw;
  }

  // velocidade horizontal de um jogador (m/s), estimada pelas posicoes: parado e mais dificil de notar que andando
  speedOf(p, dt) {
    const map = this._tp || (this._tp = new Map());
    const prev = map.get(p.id);
    let v = 0;
    if (prev && dt > 0) { const inst = Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z) / dt; v = inst < 12 ? damp(prev.v, inst, 10, dt) : 0; }   // salto (teleporte) nao conta
    map.set(p.id, { x: p.pos.x, z: p.pos.z, v });
    return v;
  }

  // Cada jogador vivo e avaliado do mesmo jeito; o medidor sobe pelo que mais chama a atencao (nunca soma)
  // e so decai quando NENHUM jogador esta sendo visto.
  // Modelo: taxa = base x visibilidade x zona do olhar (central/periferica) x distancia x movimento x cobertura; alem disso ha um
  // sensor de proximidade (360 graus, curto) e memoria curta. E deterministico: mesmas condicoes, mesmo tempo ate perceber.
  perceiveOne(p, head, dt) {
    const g = this.game;
    const eye = p.eye;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const decay = C.detectDecay * dt * (this.lastSeenT < 1.2 ? C.memoryDecay : 1);
    if (Math.abs(this.levelOf(p.pos) - this.level) > 0 || d > C.viewRange) return { sees: false, decay };
    if (p.hidden) return { sees: false, decay };
    const speed = this.speedOf(p, dt);
    const moving = speed > 0.3 || p.sprinting;
    // linha de visao: olho visivel (cheia) ou so o corpo (cobertura parcial, x0,6)
    const eyeClear = g.grid.segmentClear(head.x, head.z, eye.x, eye.z, true);
    const bodyClear = eyeClear || g.grid.segmentClear(this.pos.x, this.pos.z, p.pos.x, p.pos.z, true);
    if (!bodyClear) return { sees: false, decay };
    const losK = eyeClear ? 1 : 0.6;
    const toT = Math.atan2(dx, dz);
    const ang = Math.abs(angleDiff(this.gazeYaw(toT), toT));
    let zoneK = ang < C.fovealHalf ? 1 : ang < C.peripheralHalf ? 0.6 - 0.35 * (ang - C.fovealHalf) / (C.peripheralHalf - C.fovealHalf) : 0;
    const L = g.lighting.lightAt(p.pos.x, p.pos.z);
    let vis = C.visBase + L * 0.7;
    if (p.fl && p.fl.on) {
      vis += 0.6;
      if (p.fl.illum(head, 40) > 0) vis += 0.9;   // a luz na cara denuncia o jogador
    }
    if (p.crouch > 0.5) vis *= 0.55;
    if (p.sprinting) vis *= 1.25;
    if (!moving) vis *= C.stillFactor;
    const darkBonus = this.lightHere() < 0.2 ? 1.2 : 1;
    const df = clamp(1.3 - d / (C.viewRange * (0.45 + vis * 0.45)), 0, 1.3);
    let inc = C.detectRate * vis * df * zoneK * losK * darkBonus * this.aggr * dt;
    // sensor de proximidade: quem esta muito perto e sente, mesmo fora do cone (nao atravessa parede)
    let near = false;
    if (d < C.senseRange) {
      const sense = C.senseRate * (moving ? 1 : 0.35) * (p.crouch > 0.5 ? 0.6 : 1) * (1 - d / (C.senseRange * 1.25)) * this.aggr * dt;
      inc = Math.max(inc, sense);
      near = d < C.instantRange && (moving || vis > 0.6);
    }
    if (inc <= 0) return { sees: false, decay: decay * 0.5 };
    return { sees: true, inc, near, d };
  }

  perceive(dt) {
    const g = this.game;
    this.sees = false;
    if (g.state !== 'playing') return;
    const views = this.aliveViews();
    if (!views.length) return;
    const head = this.m.headWorld(V);
    let best = null, bestScore = -1, bestRes = null, minDecay = Infinity;
    for (const p of views) {
      const r = this.perceiveOne(p, head, dt);
      if (r.sees) {
        const score = r.inc + (r.near ? 100 : 0) + (p === this.tgt ? 1e-6 : 0);
        if (score > bestScore) { bestScore = score; best = p; bestRes = r; }
      } else if (r.decay < minDecay) minDecay = r.decay;
    }
    if (!best) { this.meter = Math.max(0, this.meter - minDecay); return; }
    this.sees = true;
    this.tgt = best;
    this.meter = Math.min(1.2, this.meter + bestRes.inc);
    if (bestRes.near) this.meter = 1.2;
    if (this.meter > 0.2) {
      // guarda tambem para onde ele ia (para procurar "a frente" quando perder de vista)
      const t = this._tp && this._tp.get(best.id);
      if (t) { this.lastSeenVel = this.lastSeenVel || new THREE.Vector3(); this.lastSeenVel.set(best.pos.x - this.lastSeen.x, 0, best.pos.z - this.lastSeen.z).multiplyScalar(this.lastSeenT > 0.5 ? 0 : 1 / Math.max(dt, 1e-3)); }
      this.lastSeen.copy(best.pos); this.lastSeenT = 0;
    }
  }

  hear(x, z, radius, kind) {
    if (['dormant', 'stunned', 'attack', 'vent'].includes(this.state)) return;
    const p = new THREE.Vector3(x, 0, z);
    const r = radius * C.hearingMult * (0.9 + this.aggr * 0.25);
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > r) return;
    if (Math.abs(this.grid.floorY(x, z) - this.pos.y) > 2.5) return;
    const sd = this.grid.soundDistance(this.pos.x, this.pos.z, x, z, r + 1);
    if (sd > r) return;
    p.y = this.grid.floorY(x, z);
    this.game.debug?.log(`ouviu ${kind} (${sd.toFixed(1)} m)`);
    if (this.state === 'chase') { this.lastSeen.copy(p); this.knowT = Math.max(this.knowT, 1.2); return; }
    if (this.state === 'stalk') { this.lastSeen.copy(p); this.meter = Math.min(1.2, this.meter + 0.2); return; }
    if (this.state === 'inspect' && kind === 'arfar') return;
    if (radius >= 10) this.meter = Math.min(0.9, this.meter + 0.25);
    this.investigate(p, radius >= 10);
  }

  investigate(p, urgent = false) {
    if (['chase', 'stunned', 'attack', 'flee', 'vent', 'inspect'].includes(this.state)) return;
    if (this.state === 'investigate' && this.sub !== 'look') {
      // ja esta indo (ou virando) para um barulho: so troca o destino, sem reiniciar a "escuta" a cada passo do jogador
      this.goal = p.clone();
      if (urgent) this.urgentInv = true;
      if (this.sub !== 'listen') { if (urgent) this.sub = 'run'; this.pathTo(this.goal, { avoidLight: 1, maxLight: this.maxLightAllowed(), partial: true }); }
      return;
    }
    this.urgentInv = urgent;
    this.setState('investigate', 'listen');          // primeiro para e vira o rosto para o som (da ao jogador um aviso), depois vai
    this.goal = p.clone();
    if (urgent) this.game.audio?.creatureCry(this.pos, 'click');
  }

  hint(p) {
    if (!['patrol', 'lurk'].includes(this.state)) return;
    this.investigate(p);
  }

  // ---------- lanterna ----------
  // Varre o feixe de cada jogador. A exposicao acumula pelo MELHOR feixe (nao soma: dois jogadores nao queimam mais rapido).
  checkFlashlight(dt) {
    const g = this.game, m = this.m;
    const head = m.headWorld(V);
    let shine = 0, anyOn = false, bestK = 0, bestView = null, bodyHit = false;
    this.lit = false;
    this.burning = false;          // true so enquanto a luz realmente queima (alcance, cone e linha de visao); os efeitos leem isto
    for (const p of this.aliveViews()) {
      const fl = p.fl;
      if (!fl) continue;
      const b = fl.beam();
      if (!b.on) continue;
      anyOn = true;
      const to = V2.copy(head).sub(b.pos);
      const d = to.length();
      to.normalize();
      const cosang = to.dot(b.dir);
      const angDeg = Math.acos(clamp(cosang, -1, 1)) * 180 / Math.PI;
      const los = g.grid.segmentClear(b.pos.x, b.pos.z, head.x, head.z, true);
      if (los && d < F.eyeshineRange && cosang > Math.cos(b.angle)) {
        // olhos refletem a luz (aviso a distancia)
        const facing = Math.cos(angleDiff(this.yaw, Math.atan2(b.pos.x - this.pos.x, b.pos.z - this.pos.z)));
        shine = Math.max(shine, clamp(facing, 0, 1) * clamp(1 - d / F.eyeshineRange, 0.25, 1) * (0.5 + b.focus * 0.5));
        this.lit = true;
      }
      const burnCone = F.burnConeDeg * (1 + (1 - clamp(d / F.burnRange, 0, 1)) * 0.6);
      const burning = los && b.focus > 0.6 && d < F.burnRange && angDeg < burnCone && !['stunned', 'flee', 'vent', 'attack'].includes(this.state);
      if (burning) {
        const face = Math.cos(angleDiff(this.yaw, Math.atan2(b.pos.x - this.pos.x, b.pos.z - this.pos.z)));
        const k = (this.shield > 0.5 ? 0.6 : 1) * (face > -0.2 ? 1 : 0.2);
        if (k > bestK) { bestK = k; bestView = p; }
      } else {
        // foco no corpo (e nao no rosto) enfurece
        const chest = m.chestWorld(V2);
        const tc = chest.clone().sub(b.pos); const dc = tc.length(); tc.normalize();
        if (b.focus > 0.6 && los && dc < F.burnRange && Math.acos(clamp(tc.dot(b.dir), -1, 1)) * 57.3 < 8 && angDeg >= burnCone && this.state === 'chase') bodyHit = true;
      }
    }
    if (bestView) {
      this.burning = true;
      this.exposure += dt * bestK;
      g.onBurnProgress?.(bestView, this.exposure / this.burnNeeded());
      if (!this._sizzling) { this._sizzling = true; g.audio?.sizzle(true, this.pos); }
      m.burnGlow = clamp(this.exposure / this.burnNeeded(), 0, 1);
      if (this.exposure >= this.burnNeeded()) this.burned();
    } else if (anyOn) {
      this.exposure = Math.max(0, this.exposure - dt * 1.5);
      if (this._sizzling) { this._sizzling = false; g.audio?.sizzle(false); }
      m.burnGlow = damp(m.burnGlow, 0, 3, dt);
      if (bodyHit) {
        if (this.enrage <= 0) g.audio?.creatureCry(this.pos, 'hiss');
        this.enrage = C.enrageOnBodyHit;
      }
    } else if (this._sizzling) { this._sizzling = false; g.audio?.sizzle(false); }
    m.eyeshine = damp(m.eyeshine, shine, 12, dt);
    // escudo: depois de ser queimada, protege o rosto quando a luz vem na cara durante a caca
    const wantShield = this.habit > 0 && this.lit && ['chase', 'stalk'].includes(this.state) && anyOn ? 1 : 0;
    this.shield = damp(this.shield, wantShield, wantShield ? 2 : 1.5, dt);
    m.setShield(this.shield);
  }

  burnNeeded() { return F.burnTime * (1 + this.habit * F.burnHabituation); }

  burned() {
    const g = this.game;
    this.exposure = 0;
    this.habit += 1;
    this.habitT = F.habituationDecay;
    g.audio?.sizzle(false); this._sizzling = false;
    g.audio?.creatureCry(this.pos, 'screech');
    this.m.cancelFlinch();      // o recuo (recoil) assume: sem duas animacoes de dor sobrepostas
    g.fx?.smokeBurst(this.m.headWorld(new THREE.Vector3()));
    g.stats.repels++;
    g.onBurnProgress?.(null, 0);
    g.onCreatureRepelled?.();
    this.setState('stunned');
    this.m.play('recoil', 0.1, { restart: true, timeScale: 1.25 });
    this._rootPrev = [0, 0];
  }

  // ---------- movimento ----------
  pathTo(target, opts = {}) {
    const g = this.grid;
    const [sx, sy] = this.cell();
    let tx = g.cellX(target.x), ty = g.cellY(target.z);
    if (!g.navWalkable(tx, ty)) {
      // procura celula livre vizinha
      let best = null, bd = 1e9;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (g.navWalkable(tx + dx, ty + dy) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = [tx + dx, ty + dy]; }
      }
      if (!best) return false;
      [tx, ty] = best;
    }
    const cells = g.findPath(sx, sy, tx, ty, { avoidLight: opts.avoidLight ?? 0, maxLight: opts.maxLight, partial: opts.partial });
    if (!cells) { this.path = []; return false; }
    this.path = g.smoothPath(cells);
    this.pathI = Math.min(1, this.path.length - 1);
    // ultimo ponto: alvo exato se estiver na mesma celula
    if (!opts.partial && this.path.length) { const last = this.path[this.path.length - 1]; if (g.cellX(target.x) === tx && g.cellY(target.z) === ty) { last[0] = target.x; last[1] = target.z; } }
    this.pathPartial = !!opts.partial && (cells.length === 0 || cells[cells.length - 1][0] !== tx || cells[cells.length - 1][1] !== ty);
    return true;
  }

  // anda pelo caminho; retorna true quando chegou
  follow(speed, dt) {
    if (!this.path.length || this.pathI >= this.path.length) { this.moveSpeed = damp(this.moveSpeed, 0, 8, dt); return true; }
    if (this.bash > 0) {
      this.bash -= dt; this.moveSpeed = 0;
      if (this.bash <= 0 && this.bashDoor) {
        this.bashDoor.setOpen(true, this.pos.x, this.pos.z, true);
        this.game.audio?.doorSlam(new THREE.Vector3(this.bashDoor.cx, this.bashDoor.base + 1, this.bashDoor.cz));
        this.game.makeNoise(this.bashDoor.cx, this.bashDoor.cz, 0, 'porta', true);
        this.bashDoor = null;
      }
      return false;
    }
    const [tx, tz] = this.path[this.pathI];
    let dx = tx - this.pos.x, dz = tz - this.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.3) { this.pathI++; return this.pathI >= this.path.length; }
    // porta fechada no caminho? olha um pouco mais longe que o alcance da cabeca, para nao enfiar a cara na porta
    for (const la of [0.9, 1.6]) {
      const lookX = this.pos.x + dx / d * la, lookZ = this.pos.z + dz / d * la;
      const door = this.grid.doors.get(this.grid.idx(this.grid.cellX(lookX), this.grid.cellY(lookZ)));
      if (door && door.blocking()) {
        if (door.creaturePassable()) { this.bash = 0.55; this.bashDoor = door; this.game.audio?.doorRattle(new THREE.Vector3(door.cx, door.base + 1, door.cz)); }
        else { this.path = []; }
        return false;
      }
    }
    if(this.skinwalker) {
      const via=skinwalkerWaypoint(this.grid,this.pos,tx,tz,this.moveSpeed,this._navigationClearance||(this._navigationClearance={}));
      if(via){dx=via.x-this.pos.x;dz=via.z-this.pos.z;d=Math.hypot(dx,dz);}
    }
    // giro com velocidade angular limitada; enquanto ainda esta virando anda mais devagar (antes ela deslizava de lado)
    const want = Math.atan2(dx, dz);
    const rate = C.turnRate[this.state === 'chase' || this.state === 'flee' ? 'chase' : ['stalk', 'hesitate', 'investigate', 'search'].includes(this.state) ? 'alert' : 'calm'];
    this.yaw += clamp(angleDiff(this.yaw, want), -rate * dt, rate * dt);
    const err = Math.abs(angleDiff(this.yaw, want));
    const align = clamp(1.25 - err / 0.9, 0.12, 1);
    const sp = speed * this.speedMods() * align;
    this.moveSpeed = damp(this.moveSpeed, sp, 8, dt);
    const step = Math.min(d, this.moveSpeed * dt);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += dx / d * step; this.pos.z += dz / d * step;
    this.collideBody();
    const fy = this.grid.floorY(this.pos.x, this.pos.z);
    this.pos.y = Math.abs(fy - this.pos.y) > 1 ? fy : damp(this.pos.y, fy, 12, dt);
    // travada em parede/movel? pula o ponto, refaz o caminho ou recentra na celula (nunca fica presa para sempre)
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    if (step > 0.004 && moved < step * 0.3) this._stuckT = (this._stuckT || 0) + dt; else this._stuckT = Math.max(0, (this._stuckT || 0) - dt * 2);
    if (this._stuckT > 0.8) this.unstick();
    return false;
  }

  // ---------- colisao do corpo e da cabeca ----------
  headReach() { return this.m.colliderReach?.() ?? C.headReach[this.m.current] ?? C.headReach.idle; }
  // empurra a criatura para fora de paredes e moveis: o corpo (circulo) contra tudo, a cabeca (circulo a frente) so contra o que e alto
  collideBody() {
    const g = this.grid;
    let [x, z] = g.collideCircle(this.pos.x, this.pos.z, C.bodyRadius);
    if (this.skinwalker) {
      const prev = this._collisionPosition;
      // Late co-op can move over two metres in a .25s server frame. Include
      // the whole previous-to-desired path in the bounded obstacle query.
      this.clearance.extremityReach=Math.max(1.65,prev?Math.hypot(x-prev.x,z-prev.z)+C.bodyRadius:0);
      const c = sampleCreatureClearance(g, x, z, this.yaw, this.pos.y, this.moveSpeed, 0, this.clearance);
      // Grid's closed-door box disappears at .72; the visible hinged slab
      // remains physical. Resolve its actual footprint in both game modes.
      const point = {x, y:this.pos.y + 0.95, z}, projected = {};
      projectBodyOutOfObstacles(point,C.bodyRadius,c.sweep.y0,c.sweep.y1,c.obstacles,projected);
      x = projected.x; z = projected.z;
      const displacement=prev?Math.hypot(x-prev.x,z-prev.z):0;
      // Exact continuous circle contacts preserve the remaining tangential
      // movement. Stopping the whole step at a jamb strands the AI; checking
      // only its endpoint can cut a rounded corner or skip a thin torso prop.
      if (prev && displacement>1e-6) {
        const a = {x:prev.x,y:this.pos.y+0.95,z:prev.z}, b = {x,y:a.y,z}, hit = {};
        let vx=x-a.x,vz=z-a.z;
        if(c.overflow){vx=0;vz=0;}
        for(let pass=0;pass<5 && Math.hypot(vx,vz)>1e-6;pass++) {
          b.x=a.x+vx;b.z=a.z+vz;
          let t=1,nx=0,nz=0;
          for(const o of c.obstacles) {
            const probe={x:a.x,y:(o.y0+o.y1)*.5,z:a.z};
            if(o.kind==='lintel' || c.sweep.y1<=o.y0 || c.sweep.y0>=o.y1 || pointBoxSignedDistance(probe,o)<C.bodyRadius-1e-6)continue;
            sweepCircleAgainstBox(a,b,o,C.bodyRadius,hit);
            if(hit.hit&&hit.t<t){t=hit.t;nx=hit.nx;nz=hit.nz;}
          }
          const safe=t<1?Math.max(0,t-.002/Math.max(1e-6,Math.hypot(vx,vz))):1;
          a.x+=vx*safe;a.z+=vz*safe;
          vx*=1-safe;vz*=1-safe;
          if(t===1)break;
          const inward=Math.min(0,vx*nx+vz*nz);
          vx-=inward*nx;vz-=inward*nz;
        }
        x=a.x;z=a.z;
      }
      // This rig fits its neck/head to the local environment after animation.
      // Its navigation footprint is the torso; a previous frame's bent head
      // cannot act as a rigid forward bumper through the next turn.
      this.pos.x=x;this.pos.z=z;this._collisionPosition={x,z};return;
    }
    const reach = this.headReach();
    let hx = x + Math.sin(this.yaw) * reach, hz = z + Math.cos(this.yaw) * reach;
    if(this.skinwalker && this.m.profile?.anatomy) {
      const head=this.m.headWorld(V),p=this.m.group.position,turn=this.yaw-this.m.group.rotation.y;
      const dx=head.x-p.x,dz=head.z-p.z;
      hx=x+Math.cos(turn)*dx+Math.sin(turn)*dz;hz=z-Math.sin(turn)*dx+Math.cos(turn)*dz;
    }
    const [qx, qz] = g.collideCircle(hx, hz, C.headRadius, { ignore: (b) => !b.vision });
    if (qx !== hx || qz !== hz) { x += qx - hx; z += qz - hz; [x, z] = g.collideCircle(x, z, C.bodyRadius); }
    this.pos.x = x; this.pos.z = z;
    if (this.skinwalker) this._collisionPosition = {x,z};
  }

  // The new long neck can travel sideways within a source pose. Resolve the
  // completed pose too, after the mixer advances; pre-animation collision alone
  // leaves a one-frame head penetration on a sharp turn or scanning gesture.
  reconcilePose() {
    if(!this.skinwalker || this.state==='vent' || (this.game.ai && this.game.ai!==this) || this.game.deathScene?.driving)return false;   // na cena de morte a pose e dela
    const g=this.grid,m=this.m,ox=this.pos.x,oz=this.pos.z;
    for(let pass=0;pass<4;pass++) {
      const head=m.headWorld(V),[hx,hz]=g.collideCircle(head.x,head.z,C.headRadius,{ignore:b=>!b.vision});
      const dx=hx-head.x,dz=hz-head.z;
      if(Math.hypot(dx,dz)<1e-5)break;
      let [x,z]=g.collideCircle(this.pos.x+dx,this.pos.z+dz,C.bodyRadius);
      const c=sampleCreatureClearance(g,x,z,this.yaw,this.pos.y,this.moveSpeed,0,this.clearance),q={};
      projectBodyOutOfObstacles({x,y:this.pos.y+.9,z},C.bodyRadius,c.sweep.y0,c.sweep.y1,c.obstacles,q);
      this.pos.x=q.x;this.pos.z=q.z;m.group.position.copy(this.pos);m.group.updateMatrixWorld?.(true);
    }
    this._collisionPosition={x:this.pos.x,z:this.pos.z};
    return Math.hypot(this.pos.x-ox,this.pos.z-oz)>1e-5;
  }

  unstick() {
    this._stuckT = 0; this._unstuckN = (this._unstuckN || 0) + 1;
    const n = this._unstuckN % 3;
    if (n === 1 && this.pathI + 1 < this.path.length) { this.pathI++; return; }
    if (n === 2) { this.path = []; this.pathI = 0; this.repathT = 0; return; }
    const [cx, cy] = this.cell();
    if (this.grid.navWalkable(cx, cy)) { this.pos.x = this.grid.cx(cx); this.pos.z = this.grid.cz(cy); }
  }

  speedMods() {
    const L = this.lightHere();
    let k = L >= C.litThreshold ? C.litSpeedPenalty : L < 0.15 ? C.darkSpeedBonus : 1;
    if (this.enrage > 0) k *= 1.15;
    if (this.shield > 0.5) k *= 0.75;
    k *= 1 + (this.aggr - 1) * 0.17;
    return k;
  }

  faceTowards(x, z, dt, rate = 6) {
    this.yaw += angleDiff(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z)) * Math.min(1, dt * rate);
  }

  // ---------- destinos ----------
  pickPatrolGoal() {
    const g = this.grid, rng = Math.random;
    const bias = this.game.director?.biasPoint();
    let best = null, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(rng() * g.W), y = Math.floor(rng() * g.H);
      if (!g.isFloor(x, y) || !g.navWalkable(x, y)) continue;
      const Z = g.zoneCfg(x, y);
      if (!Z || Z.outside) continue;
      const lvl = Z.level < 0 ? -1 : 0;
      if (lvl !== this.level && rng() > 0.12) continue;
      const cx = g.cx(x), cz = g.cz(y);
      const d = Math.hypot(cx - this.pos.x, cz - this.pos.z);
      let s = (1 - Math.min(1, g.light[g.idx(x, y)])) * 2 - Math.abs(d - 18) * 0.05;
      if (bias) s += Math.max(0, 2 - Math.hypot(cx - bias.x, cz - bias.z) / 12);
      s += rng() * 0.8;
      if (s > bs) { bs = s; best = new THREE.Vector3(cx, lvl < 0 ? -4 : 0, cz); }
    }
    return best;
  }

  pickFleeGoal() {
    const g = this.grid, p = (this.tgt || this.nearestView())?.pos || this.pos;
    let best = null, bs = -1e9;
    for (let i = 0; i < 30; i++) {
      const c = g.randomCellNear(this.pos.x / CELL, this.pos.z / CELL, 8, 20, Math.random);
      if (!c) continue;
      const cx = g.cx(c[0]), cz = g.cz(c[1]);
      if (Math.abs(g.floorY(cx, cz) - this.pos.y) > 2) continue;
      const away = Math.hypot(cx - p.x, cz - p.z);
      const s = away * 0.15 + (1 - Math.min(1, g.light[g.idx(c[0], c[1])])) * 3 + Math.random();
      if (s > bs) { bs = s; best = new THREE.Vector3(cx, g.floorY(cx, cz), cz); }
    }
    return best;
  }

  retreat(duration) {
    // o diretor manda a criatura para longe (respiro para o jogador)
    if (['chase', 'attack', 'stunned', 'vent', 'dormant'].includes(this.state)) return false;
    // ela NAO usa dutos (e grande demais para eles): anda, pelo chao, ate um ponto do mapa longe de TODOS os jogadores vivos (no solo: do jogador)
    for (const far of this.farthestFloor(this.aliveViews(), 6)) {
      const goal = new THREE.Vector3(far.x, far.y, far.z);
      if (!this.pathTo(goal, { avoidLight: 3 })) continue;          // sem caminho a pe: tenta o proximo mais longe
      this.setState('patrol'); this.goal = goal; this.firstWalk = true; this._arrived = false; this.pauseT = 0;
      this.pathTo(goal, { avoidLight: 3 });
      return true;
    }
    return false;
  }

  // Pontos de piso livres (onde o corpo dela cabe) mais distantes de TODAS as visoes dadas, do mais longe para o mais perto.
  // Usado no respiro e (no solo) para ela reaparecer longe do jogador. Nunca devolve ponto de duto nem fora do predio.
  farthestFloor(views, n = 1, level = null) {
    const g = this.grid, out = [];
    // so celulas que ela alcanca a pe daqui (portas trancadas, como a do subsolo, barram)
    const [sx, sy] = this.cell(), seen = new Uint8Array(g.W * g.H), stack = [[sx, sy]];
    seen[g.idx(sx, sy)] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!g.inb(nx, ny) || seen[g.idx(nx, ny)] || !g.navWalkable(nx, ny)) continue;
        seen[g.idx(nx, ny)] = 1; stack.push([nx, ny]);
      }
    }
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      if (!seen[g.idx(x, y)] || !g.isFloor(x, y)) continue;
      const zc = g.zoneCfg(x, y);
      if (!zc || zc.outside) continue;
      const wx = g.cx(x), wz = g.cz(y), fy = g.floorY(wx, wz);
      if (level !== null && this.levelOf({ y: fy }) !== level) continue;
      let d = Infinity;
      for (const v of views) d = Math.min(d, Math.hypot(wx - v.pos.x, wz - v.pos.z));
      if (!views.length) d = 0;
      out.push({ x: wx, y: fy, z: wz, d });
    }
    out.sort((a, b) => b.d - a.d);
    // entre os mais longes, espalha: nao devolve varios pontos vizinhos
    const picked = [];
    for (const c of out) { if (picked.every(p => Math.hypot(p.x - c.x, p.z - c.z) > 6)) picked.push(c); if (picked.length >= n) break; }
    return picked;
  }

  // ---------- quadro a quadro ----------
  update(dt) {
    const g = this.game;
    if (this.state === 'dormant') return;
    if (g.freezeAI) { this.m.group.position.copy(this.pos); this.m.group.rotation.y = this.yaw; this.visibleModel = true; return; }
    this.stateT += dt;
    this.enrage = Math.max(0, this.enrage - dt);
    this.burstCD = Math.max(0, this.burstCD - dt);
    if (this.habitT > 0) { this.habitT -= dt; if (this.habitT <= 0 && this.habit > 0) { this.habit--; this.habitT = this.habit ? F.habituationDecay : 0; } }
    this.lastSeenT += dt;
    this.aggr = g.director ? g.director.aggression() : 1;
    if (this.tgt && this.tgt.dead) this.tgt = null;

    if (this.state !== 'vent') { this.perceive(dt); this.checkFlashlight(dt); } else this.burning = false;
    if (this.sees) { this.knowT = C.loseSightTime; }

    const dPlayer = this.distToPlayer();

    // transicoes por deteccao
    if (['patrol', 'investigate', 'search', 'lurk', 'stalk'].includes(this.state)) {
      if (this.meter >= C.chaseAt) {
        if (this.state !== 'stalk' || this.stateT > 0.2) {
          const loud = this.state !== 'stalk';
          this.setState('chase');
          if (loud) { this.m.play('roar', 0.15, { restart: true, timeScale: 1.4 }); this.stateT = -0.9; g.audio?.creatureCry(this.pos, 'roar'); }
          g.onChaseStart?.();
        }
      } else if (this.meter >= C.suspicionAt && this.state !== 'stalk' && this.state !== 'hesitate') {
        this.setState('stalk');
        g.audio?.creatureCry(this.pos, 'click');
      }
    }

    switch (this.state) {
      case 'patrol': this.uPatrol(dt); break;
      case 'investigate': this.uInvestigate(dt); break;
      case 'stalk': this.uStalk(dt); break;
      case 'chase': this.uChase(dt); break;
      case 'search': this.uSearch(dt); break;
      case 'inspect': this.uInspect(dt); break;
      case 'stunned': this.uStunned(dt); break;
      case 'flee': this.uFlee(dt); break;
      case 'lurk': this.uLurk(dt); break;
      case 'hesitate': this.uHesitate(dt); break;
      case 'attack': this.uAttack(dt); break;
    }

    // nunca deixa corpo/cabeca dentro de parede ou movel (parada farejando, virando, atacando...); no duto ela some, sem colisao
    if (this.state !== 'vent') this.collideBody();

    // modelo
    const m = this.m;
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.yaw;
    this.animate(dt);
    // cabeca segue o jogador quando ciente
    const aware = ['stalk', 'chase', 'hesitate', 'attack'].includes(this.state) || (this.sees && this.meter > 0.15);
    m.lookTarget = this.lookAtPos();
    m.lookWeight = damp(m.lookWeight, aware || this.staresAt() ? 1 : 0, 4, dt);
    m.jawOpen = damp(m.jawOpen, this.state === 'chase' ? 0.55 : this.state === 'stunned' ? 0.8 : this.state === 'attack' ? 0.9 : 0.18, 5, dt);

    // voz ambiente
    this.voiceT -= dt;
    if (this.voiceT <= 0 && this.visibleModel) {
      this.voiceT = this.state === 'chase' ? range(1.2, 2.5) : range(4, 9);
      g.audio?.creatureCry(this.pos, this.state === 'chase' ? 'growl' : pick(['click', 'breath', 'moan']));
    }
    g.audio?.creatureSteps(this, dt);
  }

  // Escolhe o clipe pela velocidade REAL no chao (suavizada), com histerese, e ajusta o ritmo dos passos para os pes nao deslizarem.
  animate(dt) {
    const m = this.m;
    const moved = Math.hypot(this.pos.x - (this._ax ?? this.pos.x), this.pos.z - (this._az ?? this.pos.z));
    this._ax = this.pos.x; this._az = this.pos.z;
    const vRaw = dt > 0 && moved < 2 ? moved / dt : 0;           // saltos (teleporte, duto) nao contam como velocidade
    this._v = damp(this._v ?? 0, vRaw, 12, dt);
    const v = this._v;
    this._clipHold = Math.max(0, (this._clipHold || 0) - dt);
    const oneshotActive = ['recoil', 'attack', 'roar'].includes(m.current) && this.stateT < 0;
    if (this.state === 'stunned' || this.state === 'attack' || oneshotActive) return;
    let clip = null;
    if (this.state === 'inspect' && this.sub === 'listen') clip = 'inspect';
    else {
      const cur = m.current;
      const walking = LOCOMOTION.has(cur);
      const moving = walking ? v > 0.16 : v > 0.36;                // histerese: para de andar mais tarde do que comeca
      // hesitate fica parada e fixa no jogador: o clipe 'look' gira o quadril ate ~170 graus (virava de costas e voltava), so investigate/search olham em volta
      if (!moving) clip = (this.state === 'investigate' || this.state === 'search') ? 'look' : 'idle';
      else if (v > (cur === 'run' ? 2.7 : 3.3)) clip = 'run';
      else if ((this.state === 'stalk' || this.state === 'hesitate') && v < 1.5) clip = 'stalk';
      else if (this.state === 'patrol' || this.state === 'lurk') clip = v < 2.3 ? SLOW_WALK : 'walk';
      else clip = v < 1.15 ? SLOW_WALK : 'walk';
    }
    if (!clip) return;
    if (m.current !== clip && (this._clipHold <= 0 || !LOCOMOTION.has(m.current) || !LOCOMOTION.has(clip))) { m.play(clip, 0.25); this._clipHold = 0.3; }
    const cur = m.current, a = m.actions[cur];
    const ts = LOCOMOTION.has(cur) && cur !== 'crawl' ? clamp(v / m.clipSpeed(cur), 0.5, 1.6) : cur === 'crawl' ? 1.3 : 1;
    if (a) a.setEffectiveTimeScale(ts);
    if (cur === 'inspect' && a && a.time > m.duration('inspect') * 0.6) a.time = m.duration('inspect') * 0.35;
  }

  // ---------- estados ----------
  uPatrol(dt) {
    if (this.stateT < 0) return;
    if (!this.goal || (this.pauseT <= 0 && this.path.length === 0 && this.stateT > 0.1 && this._arrived)) {
      this._arrived = false;
      this.goal = this.firstWalk ? this.goal : this.pickPatrolGoal();
      if (!this.goal) return;
      if (!this.pathTo(this.goal, { avoidLight: 3 })) { this.goal = null; return; }
    }
    if (this.pauseT > 0) { this.pauseT -= dt; this.moveSpeed = damp(this.moveSpeed, 0, 6, dt); return; }
    if (!this.path.length && this.goal) { if (!this.pathTo(this.goal, { avoidLight: 3 })) this.goal = null; return; }
    if (this.follow(C.speed.patrol, dt)) {
      this._arrived = true; this.path = [];
      this.pauseT = range(2, 5.5);
      if (this.firstWalk) { this.firstWalk = false; this.pauseT = 3.5; }
      this.goal = null;
    }
  }

  uInvestigate(dt) {
    if (this.stateT < 0) return;
    if (this.sub === 'listen') {
      this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
      const g = this.goal, want = Math.atan2(g.x - this.pos.x, g.z - this.pos.z);
      this.faceTowards(g.x, g.z, dt, 7);
      if (this.stateT > (this.urgentInv ? 0.4 : 0.8) || (Math.abs(angleDiff(this.yaw, want)) < 0.3 && this.stateT > 0.3)) { this.sub = this.urgentInv ? 'run' : 'walk'; this.stateT = 0; }
      return;
    }
    if (this.sub === 'walk' || this.sub === 'run') {
      if (!this.path.length && this.stateT < 0.5) { if (!this.pathTo(this.goal, { avoidLight: 1, maxLight: this.maxLightAllowed(), partial: true })) { this.setState('patrol'); return; } }
      if (this.follow(this.sub === 'run' ? C.speed.investigate * 1.5 : C.speed.investigate, dt) || this.stateT > 25) {
        this.sub = 'look'; this.stateT = 0; this.lookTime = range(...C.investigateLook);
      }
    } else if (this.sub === 'look') {
      this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
      this.yaw += Math.sin(this.stateT * 0.9) * dt * 0.8;
      if (this.stateT > this.lookTime) {
        // talvez cheque um esconderijo perto
        const spot = this.nearbyUncheckedSpot(5);
        if (spot && Math.random() < C.lockerCheckChance + (this.aggr - 1) * 0.3) this.beginInspect(spot, 'patrol');
        else this.setState(this.meter > 0.2 ? 'search' : 'patrol');
        if (this.state === 'search') this.searchAround(this.goal || this.pos);
      }
    }
  }

  uStalk(dt) {
    // espreita: encara o jogador e se aproxima devagar
    const p = this.currentTarget();
    if (this.sees && p) this.faceTowards(p.pos.x, p.pos.z, dt, 3);
    this.repathT -= dt;
    if (this.repathT <= 0) { this.repathT = 0.6; this.pathTo(this.lastSeen, { avoidLight: 1, maxLight: this.maxLightAllowed() }); }
    this.follow(C.speed.stalk, dt);
    if (this.meter < 0.12 && !this.sees) {
      this.setState('investigate', 'walk'); this.goal = this.lastSeen.clone();
    }
  }

  findEdgeNear(target, maxL) {
    const g = this.grid;
    const tx = g.cellX(target.x), ty = g.cellY(target.z);
    let best = null, bs = Infinity;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!g.navWalkable(x, y) || g.light[g.idx(x, y)] > maxL) continue;
      const cx = g.cx(x), cz = g.cz(y);
      const d = Math.hypot(cx - target.x, cz - target.z);
      if (d > 11 || Math.abs(g.floorY(cx, cz) - target.y) > 1.5) continue;
      if (!g.segmentClear(cx, cz, target.x, target.z, true)) continue;
      const s = d + Math.hypot(cx - this.pos.x, cz - this.pos.z) * 0.3;
      if (s < bs) { bs = s; best = [cx, cz]; }
    }
    return best;
  }

  maxLightAllowed() {
    // em luz forte ela hesita, a menos que esteja furiosa ou no final
    if (this.enraged || this.enrage > 0) return undefined;
    return 0.85 + (this.aggr - 1) * 0.4;
  }

  // alguem ao alcance do bote (e visivel)? no solo e so o jogador local
  catchable() {
    let best = null, bd = C.catchRadius;
    for (const v of this.aliveViews()) {
      if (v.hidden) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
      if (d >= bd || Math.abs(v.pos.y - this.pos.y) >= 1.5) continue;
      const seen = v === this.tgt ? this.sees : this.grid.segmentClear(this.pos.x, this.pos.z, v.pos.x, v.pos.z, true);
      if (seen) { bd = d; best = v; }
    }
    return best;
  }

  uChase(dt) {
    const g = this.game;
    const p = this.currentTarget();
    if (this.stateT < 0) { if (p) this.faceTowards(p.pos.x, p.pos.z, dt, 5); return; }
    if (!p) { this.setState('search'); this.searchAround(this.lastSeen); return; }   // ninguem vivo por perto
    if (!this.sees) this.knowT -= dt;
    // esconderijo visto: vai direto para ele
    if (p.hidden) {
      const spot = p.hidden;
      if (spot.compromised) { this.beginInspect(spot, 'search'); return; }
      if (this.knowT <= 0) { this.setState('search'); this.searchAround(this.lastSeen); return; }
    }
    const tracking = this.knowT > 0 && !p.hidden;
    const target = tracking ? p.pos : this.lastSeen;
    if (tracking) this.lastSeen.copy(p.pos);
    // ela ja esta DENTRO de luz forte (a luz acendeu com ela ali, saiu de um duto, vinha da patrulha) e o alvo tambem: na caca essas celulas
    // sao proibidas (o caminho so barra a ENTRADA na luz), entao nao persegue por dentro dela: para e encara, como na borda
    const maxLit = this.maxLightAllowed();
    if (maxLit !== undefined && this.lightHere() > maxLit && this.game.lighting.lightAt(target.x, target.z) > maxLit) { this.setState('hesitate'); return; }
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.repathT = 0.25;
      const maxL = this.maxLightAllowed();
      let ok = this.pathTo(target, { avoidLight: 0.3, maxLight: maxL, partial: true });
      if (ok && this.pathPartial && maxL !== undefined) {
        // alvo dentro da luz forte: vai para a borda escura de onde consegue ve-lo
        const e = this.findEdgeNear(target, maxL);
        if (e) { ok = this.pathTo(new THREE.Vector3(e[0], 0, e[1]), { avoidLight: 0.3, maxLight: maxL }); this.pathPartial = true; }
      }
      if (!ok && this.levelOf(target) !== this.level) { this.setState('search'); this.searchAround(this.pos); return; }
    }
    const atEnd = !this.path.length || this.pathI >= this.path.length;
    if (this.pathPartial && atEnd && this.bash <= 0) {
      // o jogador esta numa area muito iluminada: hesita na borda da luz (ou procura por perto)
      const los = this.grid.segmentClear(this.pos.x, this.pos.z, p.pos.x, p.pos.z, true);
      if ((this.sees || tracking || los) && !p.hidden) { this.setState('hesitate'); return; }
      this.setState('search'); this.searchAround(this.pos); return;
    }
    this.follow(C.speed.chase, dt);
    const victim = this.catchable();
    if (victim) { this.tgt = victim; this.beginAttack(); return; }
    if (!tracking && Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z) < 1.2) {
      this.setState('search'); this.searchAround(this.lastSeen);
    }
  }

  uHesitate(dt) {
    // parada na borda da luz, olhando o jogador, balancando
    const p = this.currentTarget();
    this.moveSpeed = damp(this.moveSpeed, 0, 6, dt);
    if (p) this.faceTowards(p.pos.x, p.pos.z, dt, 4);
    // a luz forte a segura, mas se alguem ENCOSTA nela (ao alcance do bote) ela ataca do mesmo jeito
    const touched = this.catchable();
    if (touched) { this.tgt = touched; this.beginAttack(); return; }
    if (this.stateT > 4.5 && this.burstCD <= 0) {
      // estoura a lampada mais proxima e avanca
      const lamp = this.game.lighting.lamps.filter(l => l.on && l.state !== 'dead' && l.type !== 'emerg')
        .map(l => [Math.hypot(l.x - this.pos.x, l.z - this.pos.z), l]).filter(a => a[0] < 9).sort((a, b) => a[0] - b[0])[0];
      if (lamp) {
        this.game.burstLamp(lamp[1]);
        this.burstCD = 30;
        this.setState('chase');
        this.knowT = C.loseSightTime;
        return;
      }
    }
    if (this.stateT > 11 || (!this.sees && this.stateT > 3)) {
      // desiste por enquanto: some no escuro e volta a procurar depois
      this.setState('flee'); this.fleeGoal = this.pickFleeGoal(); this.meter = 0.3;
    }
  }

  searchAround(center) {
    this.searchCenter = center.clone();
    // perdeu de vista correndo? procura um pouco A FRENTE, na direcao em que ele ia (nao so no ultimo ponto visto)
    if (center === this.lastSeen && this.lastSeenVel && this.lastSeenVel.lengthSq() > 1) {
      const sp = Math.min(this.lastSeenVel.length(), 6), k = Math.min(3.5, sp * 0.8) / Math.max(sp, 1e-3);
      const ax = center.x + this.lastSeenVel.x * k, az = center.z + this.lastSeenVel.z * k;
      if (this.grid.navWalkable(this.grid.cellX(ax), this.grid.cellY(az)) && this.grid.segmentClear(center.x, center.z, ax, az, false)) { this.searchCenter.x = ax; this.searchCenter.z = az; }
    }
    this.searchEnd = range(...C.searchTime);
    this.checked.clear();
    this.goal = null;
  }

  nearbyUncheckedSpot(r) {
    let best = null, bd = r;
    for (const s of this.game.world.hideSpots) {
      if (this.checked.has(s)) continue;
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < bd && Math.abs(s.base - this.pos.y) < 2) { bd = d; best = s; }
    }
    return best;
  }

  uSearch(dt) {
    if (!this.searchCenter) this.searchAround(this.pos);
    if (this.stateT > this.searchEnd) { this.setState('patrol'); return; }
    if (this.pauseT > 0) {
      this.pauseT -= dt; this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
      this.yaw += Math.sin(this.stateT * 1.3) * dt;
      return;
    }
    if (!this.path.length || this.pathI >= this.path.length) {
      // decide: checar esconderijo ou andar para outro ponto
      const spot = this.nearbyUncheckedSpot(6.5);
      const chance = C.lockerCheckChance + (this.aggr - 1) * 0.35 + (spot && this.occupantOf(spot) ? 0.25 : 0);
      if (spot && this.checked.size < 3 && Math.random() < chance) { this.beginInspect(spot, 'search'); return; }
      if (spot) this.checked.add(spot);
      const c = this.grid.randomCellNear(this.searchCenter.x / CELL, this.searchCenter.z / CELL, 1.5, 9, Math.random);
      if (c) this.pathTo(new THREE.Vector3(this.grid.cx(c[0]), 0, this.grid.cz(c[1])), { avoidLight: 0.5, maxLight: this.maxLightAllowed(), partial: true });
      this.pauseT = range(1.2, 3);
      return;
    }
    this.follow(C.speed.search, dt);
  }

  // onde ela para para farejar: longe o bastante para a cabeca (inclinada no clipe "inspect") nao entrar no armario
  inspectStand(spot) {
    const dx = spot.inspectPos.x - spot.x, dz = spot.inspectPos.z - spot.z, len = Math.hypot(dx, dz) || 1;
    const D = Math.max(len, 0.3 + C.headReach.inspect + C.headRadius + 0.08);
    return new THREE.Vector3(spot.x + dx / len * D, spot.inspectPos.y, spot.z + dz / len * D);
  }

  beginInspect(spot, after) {
    this.setState('inspect', 'approach');
    this.inspectSpot = spot; this.afterInspect = after; this.noHold = 0;
    this.inspectAt = this.inspectStand(spot);
    this.pathTo(this.inspectAt);
  }

  uInspect(dt) {
    const spot = this.inspectSpot, g = this.game;
    if (this.sub === 'approach') {
      const arrived = this.follow(spot.compromised ? C.speed.chase * 0.8 : C.speed.search, dt);
      const at = this.inspectAt || spot.inspectPos;
      if (arrived || Math.hypot(at.x - this.pos.x, at.z - this.pos.z) < 0.5 || this.stateT > 15) {
        this.sub = 'listen'; this.stateT = 0;
        this.listenTime = spot.compromised ? 0.6 : C.inspectTime * range(0.85, 1.15);
        g.audio?.creatureCry(this.pos, 'sniff');
        g.onInspectStart?.(spot);
      }
      return;
    }
    // escutando / farejando na frente do esconderijo
    this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
    this.faceTowards(spot.x, spot.z, dt, 5);
    const occ = this.occupantOf(spot);
    const inside = !!occ;
    if (inside) {
      if (spot.compromised) { this.pullOut(spot); return; }
      if (!occ.holdingBreath && this.stateT > 0.6) this.noHold += dt;
      if (this.noHold > 1.1) { this.pullOut(spot); return; }
    }
    if (this.stateT > this.listenTime) {
      this.checked.add(spot);
      this.inspectSpot = null;
      g.onInspectEnd?.(spot, inside);
      if (this.afterInspect === 'search') { this.setState('search'); if (!this.searchCenter) this.searchAround(this.pos); }
      else this.setState('patrol');
    }
  }

  onPlayerGasp(view) {
    if (this.state === 'inspect' && this.inspectSpot && view && view.hidden === this.inspectSpot && this.sub === 'listen') { this.pullOut(this.inspectSpot); }
  }

  pullOut(spot) {
    const g = this.game;
    const occ = this.occupantOf(spot);
    spot.target = 1;   // porta do armario escancarada
    g.audio?.lockerBang(new THREE.Vector3(spot.x, spot.base + 1, spot.z));
    g.forceUnhide(spot, occ);
    if (occ) this.tgt = occ;
    this.beginAttack(true);
  }

  uStunned(dt) {
    // recuo com root motion (reduzido) enquanto queima
    const a = this.m.actions.recoil;
    const t = a ? a.time : this.stateT;
    const [rx, rz] = this.m.rootAt('recoil', t);
    const [px, pz] = this._rootPrev || [0, 0];
    this._rootPrev = [rx, rz];
    const k = 0.45;
    const dx = (rx - px) * k, dz = (rz - pz) * k;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let nx = this.pos.x + dx * c + dz * s, nz = this.pos.z - dx * s + dz * c;
    this.pos.x = nx; this.pos.z = nz; this.collideBody();
    this.pos.y = this.grid.floorY(nx, nz);
    this.m.burnGlow = damp(this.m.burnGlow, 0, 2, dt);
    if (this.stateT > C.stunTime) {
      this.setState('flee');
      this.fleeGoal = this.pickFleeGoal();
      this.meter = 0.6;
    }
  }

  uFlee(dt) {
    if (!this.fleeGoal) { this.setState('lurk'); this.lurkTime = range(...C.fleeTime); return; }
    if (!this.path.length && this.stateT < 0.3) this.pathTo(this.fleeGoal, { avoidLight: 4 });
    if (this.follow(C.speed.flee, dt) || this.stateT > 8) {
      this.setState('lurk'); this.lurkTime = range(...C.fleeTime);
      this.returnToSearch = true;
    }
  }

  uLurk(dt) {
    this.moveSpeed = damp(this.moveSpeed, 0, 6, dt);
    if (this.stateT > (this.lurkTime ?? 8)) {
      if (this.returnToSearch) { this.returnToSearch = false; this.setState('search'); this.searchAround(this.lastSeen); }
      else this.setState('patrol');
    }
  }

  beginAttack(fromHide = false) {
    const g = this.game;
    const v = this.currentTarget();
    this.setState('attack');
    this.m.play('attack', 0.08, { restart: true, timeScale: 1.35 });
    if (v) this.faceTowards(v.pos.x, v.pos.z, 1, 100);
    g.audio?.creatureCry(this.pos, 'attack');
    g.onCaught?.(this, fromHide, v);
  }

  uAttack(dt) {
    const p = this.tgt;
    this.moveSpeed = 0;
    if (p && !this.game.deathScene?.driving) {         // com a cena de morte, quem posiciona a criatura e ela
      this.faceTowards(p.pos.x, p.pos.z, dt, 12);
      // aproxima ate ficar cara a cara
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d > 0.85) {
        const k = Math.min(1, dt * 6);
        this.pos.x += (p.pos.x - this.pos.x) * k * (1 - 0.85 / d);
        this.pos.z += (p.pos.z - this.pos.z) * k * (1 - 0.85 / d);
        this.collideBody();
      }
    }
    if (this.stateT > 0.75 && !this._killed) { this._killed = true; this.game.playerDies(p); }
    // cooperativo: os outros continuam vivos, entao a criatura segue a caca em vez de ficar parada sobre o corpo
    if (this._killed && this.game.multi && this.stateT > 1.6) {
      this._killed = false; this.tgt = null; this.meter = 0; this.knowT = 0; this.exposure = 0;
      this.setState('search'); this.searchAround(this.pos);
    }
  }

  // volta a ficar adormecida, como no inicio da partida (Hardcore / nova rodada)
  hardReset() {
    this.reset();
    this.game.audio?.sizzle(false); this._sizzling = false;
    this.state = 'dormant'; this.stateT = 0; this.sub = null;
    this.habit = 0; this.habitT = 0; this.lurkTime = 0; this.returnToSearch = false; this.firstWalk = false; this._arrived = false;
    this.aggr = 1; this.enraged = false; this.burning = false; this.sees = false; this.lit = false;
    this.goal = null; this.fleeGoal = null; this.searchCenter = null; this.lastSeenT = 99; this.moveSpeed = 0;
    this.burstCD = 0; this.pauseT = 0; this.voiceT = 3; this.checked.clear(); this.afterInspect = null; this.noHold = 0;
    this.visibleModel = false;
    this.m.group.visible = false; this.m.cancelFlinch(); this.m.play('idle', 0, { restart: true });
  }

  reset() {
    this._collisionPosition=null;
    this._killed = false; this.tgt = null;
    this.meter = 0; this.knowT = 0; this.exposure = 0; this.enrage = 0; this.shield = 0;
    this.m.setShield(0); this.m.burnGlow = 0; this.m.eyeshine = 0;
    this.path = []; this.vent = null; this.inspectSpot = null; this.bash = 0; this.bashDoor = null;
    this.m.group.visible = this.state !== 'dormant';
  }
}
