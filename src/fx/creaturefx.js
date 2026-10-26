// Retorno visual e sonoro da queimadura da criatura: fumaça leve no corpo enquanto a luz REALMENTE queima
// (alcance, cone e linha de visão já validados pela IA) e uma reação curta de dor.
// Não altera a IA: só lê `burning`. Tudo é limitado por um pool fixo e para assim que a queimadura termina.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

export const BURN_FX = {
  maxPuffs: 36,            // teto de sprites vivos (nunca cria mais que isso)
  headRate: 7,             // baforadas por segundo saindo do rosto
  bodyRate: 2.5,           // e do peito
  life: [0.8, 1.25],       // vida de cada baforada (s)
  rise: 0.55,              // subida (m/s)
  opacity: 0.3,
  size: [0.09, 0.3],       // escala inicial -> final
  flinchCooldown: 1.6,     // s minimos entre duas reações de dor (evita animações sobrepostas)
  stopFade: 0.35,          // ao parar de queimar, as baforadas restantes somem em ate X s
  burstPuffs: 10,          // baforadas extras quando ela e repelida (queimadura completa)
};

export class CreatureFx {
  constructor(scene, softTex) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < BURN_FX.maxPuffs; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x9a978f, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; s.scale.setScalar(0.1);
      scene.add(s);
      this.pool.push({ s, age: 0, life: 1, v: new THREE.Vector3(), a0: 0, size: 0.1, on: false });
    }
    this.acc = 0; this.bodyAcc = 0; this.cool = 0; this.wasBurning = false;
    this.alive = 0;
  }

  _spawn(p, spread = 0.06, up = 1) {
    const q = this.pool.find(x => !x.on);
    if (!q) return false;                      // pool cheio: descarta (nada de excesso de particulas)
    const F = BURN_FX;
    q.on = true; q.age = 0; q.life = F.life[0] + Math.random() * (F.life[1] - F.life[0]);
    q.s.position.set(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread);
    q.v.set((Math.random() - 0.5) * 0.25, F.rise * up * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.25);
    q.size = F.size[0]; q.s.scale.setScalar(q.size); q.a0 = F.opacity * (0.7 + Math.random() * 0.3);
    q.s.material.opacity = q.a0; q.s.visible = true;
    return true;
  }

  // burning: a IA (ou o servidor) disse que a luz esta queimando agora. model: CreatureModel. audio: Audio (opcional).
  update(dt, burning, model, audio, opts = {}) {
    const F = BURN_FX;
    this.cool = Math.max(0, this.cool - dt);
    const visible = burning && model && model.group.visible && !opts.suppress;
    if (visible) {
      const head = model.headWorld(V0), chest = model.chestWorld(V1);
      this.acc += F.headRate * dt; this.bodyAcc += F.bodyRate * dt;
      while (this.acc >= 1) { this.acc -= 1; this._spawn(head, 0.08); }
      while (this.bodyAcc >= 1) { this.bodyAcc -= 1; this._spawn(chest, 0.16); }
      if (!this.wasBurning && this.cool <= 0 && !opts.noFlinch) {
        // comeco real da queimadura: uma unica reacao de dor curta (com gemido), nunca empilhada
        if (model.flinch(1)) { this.cool = F.flinchCooldown; audio?.creatureCry(model.group.position, 'pain'); }
      }
    } else if (this.wasBurning) {
      // a queimadura terminou: nenhuma baforada nova; as que restam somem rapido
      this.acc = this.bodyAcc = 0;
      for (const q of this.pool) if (q.on) q.life = Math.min(q.life, q.age + F.stopFade);
    }
    this.wasBurning = !!visible;

    for (const q of this.pool) {
      if (!q.on) continue;
      q.age += dt;
      if (q.age >= q.life) { q.on = false; q.s.visible = false; continue; }
      const k = q.age / q.life;
      q.s.position.addScaledVector(q.v, dt);
      q.v.multiplyScalar(1 - dt * 0.9);
      q.s.scale.setScalar(F.size[0] + (F.size[1] - F.size[0]) * Math.sqrt(k));
      q.s.material.opacity = q.a0 * (1 - k) * clamp(q.age / 0.08, 0, 1);
    }
  }

  // queimadura completa (ela foi repelida): mais fumaça de uma vez, ainda limitada pelo pool
  smokeBurst(p) {
    for (let i = 0; i < BURN_FX.burstPuffs; i++) this._spawn(p, 0.16, 1.2);
  }
  burst(p) { this.smokeBurst(p); }

  // remove tudo na hora (morte, fim da partida, volta ao menu)
  clear() {
    for (const q of this.pool) { q.on = false; q.s.visible = false; }
    this.acc = this.bodyAcc = 0; this.wasBurning = false;
  }

  get active() { return this.pool.reduce((n, q) => n + (q.on ? 1 : 0), 0); }
}

const V0 = new THREE.Vector3(), V1 = new THREE.Vector3();
