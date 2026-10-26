// A criatura no cooperativo: o estado oficial vem do servidor (uma criatura por sala). Esta classe imita a interface
// da CreatureAI para o resto do jogo (HUD, audio, fumaca, luzes) e so INTERPOLA e anima o modelo.
import * as THREE from 'three';
import { CREATURE_STATES, CREATURE_SUBS, CLIPS } from './protocol.js';
import { COOP } from '../shared/coop.js';
import { clamp, damp, angleDiff } from '../core/rng.js';

const ONESHOT = ['roar', 'recoil', 'attack'];

export class NetCreature {
  constructor(game, model) {
    this.game = game; this.m = model; this.grid = game.grid;
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.state = 'dormant'; this.sub = null; this.stateT = 0;
    this.moveSpeed = 0; this.visibleModel = false; this.burning = false; this.enraged = false;
    this.meter = 0; this.exposure = 0; this.habit = 0; this.sees = false; this.lit = false; this.shield = 0;
    this.buf = []; this._ps = -1; this._look = new THREE.Vector3(); this.vent = null; this.ventOpen = new Set();
    this.m.group.visible = false;
  }

  // snapshot do servidor (campos curtos, ver Match._creatureSnap)
  onSnap(c, t) {
    this.buf.push({ t, c });
    if (this.buf.length > 10) this.buf.shift();
    // estado discreto vale na hora (nao interpolado)
    this.state = CREATURE_STATES[c.s] || 'dormant'; this.sub = CREATURE_SUBS[c.u] ?? null;
    this.stateT = c.t; this.enraged = !!c.en; this.burning = !!c.bn; this.moveSpeed = c.sp;
    this.visibleModel = !!c.v;
    this.snap = c;
  }

  distToPlayer() { const p = this.game.player.pos; return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  hear() {}                                    // o servidor cuida da audicao
  update(dt) {
    const g = this.game, m = this.m, c = this.snap;
    if (!c || this.state === 'dormant') { m.group.visible = false; this.visibleModel = false; return; }
    // interpolacao de posicao/olhar com atraso fixo
    const rt = performance.now() / 1000 - COOP.interpDelay;
    let a = this.buf[0], b = this.buf[0];
    for (let i = this.buf.length - 1; i > 0; i--) if (this.buf[i - 1].t <= rt) { a = this.buf[i - 1]; b = this.buf[i]; break; }
    if (this.buf.length && rt > this.buf[this.buf.length - 1].t) a = b = this.buf[this.buf.length - 1];
    const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const A = a.c, B = b.c;
    const teleported = Math.hypot(B.x - A.x, B.z - A.z) > 4;       // duto/vent: nao desliza pelo mapa
    const kk = teleported ? 1 : k;
    this.pos.set(A.x + (B.x - A.x) * kk, A.y + (B.y - A.y) * kk, A.z + (B.z - A.z) * kk);
    this.yaw += angleDiff(this.yaw, B.yw) * Math.min(1, dt * 14);
    if (teleported || this._first) { this.yaw = B.yw; }
    this._first = false;

    m.group.visible = !!c.v;
    if (g.deathScene?.driving) return;             // cena de morte do jogador local: posicao, pose e clipe sao dela
    m.group.position.copy(this.pos); m.group.rotation.y = this.yaw;
    // clipe / velocidade de reproducao
    const clip = CLIPS[c.cl];
    if (clip && m.actions[clip]) {
      const restart = c.ps !== this._ps && ONESHOT.includes(clip);
      if (m.current !== clip || restart) { m.play(clip, ONESHOT.includes(clip) ? 0.1 : 0.35, { restart, timeScale: c.ts }); }
      this._ps = c.ps;
      const act = m.actions[clip];
      act.setEffectiveTimeScale(clamp(c.ts, 0.35, 1.8));
      if (clip === 'inspect' && act.time > m.duration('inspect') * 0.6) act.time = m.duration('inspect') * 0.35;
    }
    // cabeca, mandibula, brilho
    if (c.lk) { this._look.set(c.lk[0], c.lk[1], c.lk[2]); m.lookTarget = this._look; } else m.lookTarget = null;
    m.lookWeight = damp(m.lookWeight, c.lw, 8, dt);
    m.jawOpen = damp(m.jawOpen, this.state === 'chase' ? 0.55 : this.state === 'stunned' ? 0.8 : this.state === 'attack' ? 0.9 : 0.18, 5, dt);
    m.burnGlow = c.bg; m.eyeshine = damp(m.eyeshine, c.es, 12, dt);
    this.shield = damp(this.shield, c.sh, 8, dt); m.setShield(this.shield);
    this.lit = c.es > 0.05;
    // grades dos dutos abrindo/fechando
    const vents = g.world.vents;
    for (const i of this.ventOpen) vents[i].grate.rotation.x = 0;
    this.ventOpen.clear();
    if (this.state === 'vent' && c.vt) {
      if (this.sub === 'enter') { vents[c.vt[0]].grate.rotation.x = -Math.min(1.2, this.stateT * 2); this.ventOpen.add(c.vt[0]); }
      else if (this.sub === 'exit') { vents[c.vt[1]].grate.rotation.x = -Math.min(1.2, (1.1 - this.stateT) * 2); this.ventOpen.add(c.vt[1]); }
    }
    g.audio?.creatureSteps(this, dt);
  }

  reset() { this.buf.length = 0; this.snap = null; this.state = 'dormant'; this.visibleModel = false; this.burning = false; this.m.group.visible = false; this._first = true; this.enraged = false; this._ps = -1; }
}
