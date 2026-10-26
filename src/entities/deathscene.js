// CENA DE MORTE (so no cliente): o que o jogador ve quando a criatura o pega.
// Roteiro fixo (a mesma coisa toda vez), contado em segundos a partir do instante da captura (Game.onCaught):
//   0.00  o grito de ataque (som original, nao mexe): ela se ergue para trás, braços abertos, e o jogador recua
//   0.20  o bote: o tronco dobra sobre o jogador como um abutre; o rosto desce ate a altura dos olhos
//   0.75  AGARRAO: as maos fecham nos ombros junto com o 2o estouro de som (audio.death, 0.75 s apos a captura): batida, clarao, congelada curta
//   0.85  ela ergue e sacode o jogador (camera sobe e treme), sangue na lente
//   2.00  bote final: o rosto se projeta e a camera e puxada para dentro da boca
//   2.40  clarao vermelho e escuro; 3.05 tela de morte
// O som nao e alterado: o grito sai em 0 s (beginAttack) e o 2o estouro em 0,75 s (CreatureAI.uAttack -> Game.playerDies), igual a antes.
// Esta classe so lida com camera, efeitos de tela, luz e a pose do corpo da criatura (DeathPose); a IA e o servidor nao sabem dela.
import * as THREE from 'three';
import { clamp, damp, angleDiff, lerp } from '../core/rng.js';

export const DEATH = {
  impactT: 0.75,        // agarrao (casa com o 2o estouro de som)
  biteT: 2.0,           // comeco do bote final
  blackT: 2.42,         // clarao e escuro
  endT: 3.05,           // fim da cena (tela de morte)
  faceDist: 0.52,       // m: distancia horizontal do rosto dela aos olhos do jogador enquanto o segura (o pivo dela se ajusta a isso)
  fov: 72,              // o mesmo da camera do jogo
};

const S = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };    // smoothstep
const EO = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);                                              // sai rapido, assenta
const EI = (x) => Math.pow(clamp(x, 0, 1), 2.4);                                                    // acelera e para de uma vez
const imp = (x, k) => (x < 0 ? 0 : Math.exp(-x / k));                                               // pancada: pico em 0, some em ~k s

// Tudo que varia no tempo, numa funcao pura (testavel sem navegador): t = segundos desde a captura.
export function sampleDeath(t) {
  const I = DEATH.impactT, B = DEATH.biteT;
  const rear = -0.16 * S(0, 0.2, t) * (1 - S(0.2, 0.34, t));                 // ergue-se antes de dar o bote
  const dive = Math.pow(clamp((t - 0.22) / 0.42, 0, 1), 2.2);                // mergulho: acelera e para no agarrao
  const bite = EI((t - B) / 0.4);                                            // bote final 0..1
  const hit = imp(t - I, 0.12), hitL = imp(t - I, 0.35), hitXL = imp(t - I, 0.9);
  const flashRed = S(B, DEATH.blackT, t);
  return {
    fold: rear + dive - 0.38 * S(0.9, 1.75, t) + 0.3 * bite,                  // mergulha, se endireita um pouco erguendo o jogador, e se projeta no bote final
    neck: 0.3 * S(0.35, 0.7, t) + 0.7 * bite,
    reach: S(0.36, I, t),
    tilt: 0.5 * S(0.15, 0.75, t) + 0.1 * Math.sin(t * 1.9) * S(0.8, 1.3, t),   // a cabeca se inclina de um jeito que humano nenhum faria
    splay: S(0.3, 0.7, t),
    shake: t < I ? 0.15 * S(0.4, I, t) : clamp(1 - 0.5 * S(I, 2.0, t) + 0.1 * S(B, 2.3, t), 0, 1),
    dist: EO(t / 0.5),                                                       // 0 = onde ela estava, 1 = onde a malha fechada do rosto manda
    faceTarget: lerp(DEATH.faceDist, 0.3, bite),
    along: -0.16 * S(0, 0.35, t) * (1 - S(0.55, 0.74, t)) + (0.14 + 0.2 * (1 - S(I, I + 0.2, t))) * S(I - 0.01, I + 0.04, t),   // camera: recua com o susto, e e puxada no agarrao
    liftK: S(0.8, 1.7, t),                                                   // ela ergue o jogador: a camera sobe ate a altura do rosto dela
    bite,
    trauma: clamp(0.28 * S(0.05, 0.5, t) + hitXL + 0.45 * S(B, 2.3, t), 0, 1),
    roll: 0.13 * hitL + 0.045 * Math.sin(t * 2.6) * S(0.8, 1.2, t) + 0.1 * S(1.9, 2.4, t),
    kick: hit,                                                               // pancada na cabeca (pitch)
    track: S(0.25, 0.4, t) * (1 - S(1.0, 1.3, t)),                           // 0..1: o olhar acompanha o rosto mais depressa durante o mergulho e o agarrao
    fov: DEATH.fov - 8 * S(0, 0.3, t) + 22 * imp(t - I, 0.09) - 4 * S(0.8, 2.0, t) - 12 * bite,
    flash: 0.6 * imp(t - I, 0.07) + S(2.3, 2.4, t) * (1 - S(2.4, 2.5, t)),
    flashRed,
    shock: 0.9 * imp(t - I, 0.22) + 0.8 * S(B, 2.4, t),
    tunnel: 0.15 * S(0, 0.6, t) + 0.45 * S(I, 2.0, t) + 0.4 * S(2.0, 2.5, t),
    pulse: 0.25 * S(0, 0.6, t) + 0.3 * S(I, 1.2, t),
    fade: S(DEATH.blackT, DEATH.blackT + 0.28, t),
    light: 2.6 * S(0.05, 0.4, t) * (1 - 0.5 * S(2.2, 2.5, t)),
    timeScale: 1 - 0.9 * S(I - 0.005, I + 0.015, t) * (1 - S(I + 0.08, I + 0.11, t)),   // congelada curta no agarrao
  };
}

// sangue na lente (canvas 2D por cima do jogo, sob o HUD e as telas)
class LensBlood {
  constructor() { this.cv = null; this.ctx = null; this.drips = []; this.seed = 1; }
  _rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  ensure() {
    if (this.cv) return true;
    if (typeof document === 'undefined') return false;                      // testes sem navegador
    const cv = document.createElement('canvas');
    cv.id = 'deathBlood';
    Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '4', pointerEvents: 'none', transition: 'opacity .9s', filter: 'blur(0.7px)' });
    const k = Math.min(1, 1280 / Math.max(1, innerWidth));
    cv.width = Math.max(2, Math.round(innerWidth * k)); cv.height = Math.max(2, Math.round(innerHeight * k));
    document.body.appendChild(cv);
    this.cv = cv; this.ctx = cv.getContext('2d');
    return true;
  }
  clear() {
    this.drips.length = 0;
    if (this.cv) { this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); this.cv.style.opacity = '1'; }
  }
  remove() { if (this.cv) { this.cv.remove(); this.cv = null; this.ctx = null; } this.drips.length = 0; }
  fadeOut() { if (this.cv) this.cv.style.opacity = '0'; }
  // x, y em 0..1 da tela; r relativo a altura. Mancha irregular (elipses sobrepostas, borda escura e miolo mais vivo), respingos em leque e um fio que escorre
  splat(x, y, r) {
    if (!this.ensure()) return;
    const c = this.ctx, W = this.cv.width, H = this.cv.height, px = x * W, py = y * H, R = r * H, rnd = () => this._rnd();
    const fan = (rnd() - 0.5) * 1.6;                                         // direcao do respingo (relativo a "para baixo")
    const blob = (cx, cy, rx, ry, rot, a) => {                               // sangue na lente: miolo espesso e escuro, bordas finas e translucidas
      c.save(); c.translate(cx, cy); c.rotate(rot); c.scale(1, ry / rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(66,3,5,${0.92 * a})`); g.addColorStop(0.7, `rgba(84,4,6,${0.86 * a})`); g.addColorStop(0.93, `rgba(92,4,7,${0.5 * a})`); g.addColorStop(1, 'rgba(92,4,7,0)');   // sem aro claro: sobrepostas viram uma massa so
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 6.283); c.fill();
      c.restore();
    };
    const n = 3 + Math.floor(R / (H * 0.03));
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, d = rnd() * R * 0.5, rx = R * (0.32 + rnd() * 0.5);
      blob(px + Math.cos(a) * d, py + Math.sin(a) * d, rx, rx * (0.45 + rnd() * 0.45), rnd() * 3.14, 1);
    }
    const sp = 6 + Math.floor(R / (H * 0.012));
    for (let i = 0; i < sp; i++) {
      const a = Math.PI / 2 + fan + (rnd() - 0.5) * 2.6, d = R * (0.8 + rnd() * 1.5), rr = Math.max(1.2, R * (0.03 + rnd() * 0.09));
      blob(px + Math.cos(a) * d, py + Math.sin(a) * d, rr * (1 + rnd()), rr, a, 0.95);
    }
    c.fillStyle = 'rgba(255,200,190,0.22)'; c.beginPath(); c.ellipse(px - R * 0.2, py - R * 0.22, R * 0.09, R * 0.035, -0.55, 0, 6.283); c.fill();   // um brilho pequeno de coisa molhada
    this.drips.push({ x: px + (rnd() - 0.5) * R * 0.5, y: py + R * 0.35, w: Math.max(2, R * 0.16), v: H * (0.03 + rnd() * 0.06), life: 1.6 + rnd() * 2 });
  }
  update(dt) {
    if (!this.cv) return;
    const c = this.ctx;
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.life -= dt; if (d.life <= 0) { this.drips.splice(i, 1); continue; }
      const y1 = d.y + d.v * dt;
      c.strokeStyle = 'rgba(88,3,5,0.88)'; c.lineWidth = d.w * (0.5 + d.life * 0.25); c.lineCap = 'round';
      c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x, y1); c.stroke();
      d.y = y1; d.v *= 1 - dt * 0.5;
    }
  }
}

const BLOOD_EVENTS = [          // [t, n, raio min, raio max]: pingos pequenos no agarrao, borrifo na sacudida, jorro no bote final
  [0.78, 4, 0.03, 0.06], [1.2, 3, 0.05, 0.09], [1.55, 4, 0.05, 0.1], [2.1, 3, 0.1, 0.18], [2.28, 3, 0.14, 0.24],
];

export class DeathScene {
  constructor(game) {
    this.game = game;
    this.blood = new LensBlood();
    this.light = null;
    this.t = -1; this.finished = false; this.creature = null;
    this.base = new THREE.Vector3(); this.dir = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this.head = new THREE.Vector3(); this.headS = new THREE.Vector3(); this.eye = new THREE.Vector3(); this.right = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.s = sampleDeath(0);
  }

  get running() { return this.t >= 0; }
  get driving() { return this.t >= 0; }                    // a IA e a rede deixam a criatura em paz enquanto a cena roda
  get done() { return this.t >= 0 && this.finished; }
  get timeScale() { return this.t >= 0 && !this.finished ? this.s.timeScale : 1; }

  start(creature, { fromHide = false } = {}) {
    if (this.t >= 0) return;                               // segundo aviso (mensagens de rede): a cena ja esta rodando
    const g = this.game, p = g.player, cam = g.camera;
    this.creature = creature; this.finished = false; this.t = 0; this.first = true; this.fromHide = fromHide;
    this.base.set(p.pos.x, p.pos.y + p.eyeY, p.pos.z);
    const dx = creature.pos.x - p.pos.x, dz = creature.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.05) this.dir.set(dx / d, 0, dz / d); else this.dir.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    this.d0 = clamp(d, 0.6, 1.6);
    this.baseFov = cam.fov;
    this.yaw = p.yaw; this.pitch = p.pitch;
    // quanto a camera pode recuar sem entrar na parede
    this.maxBack = 0;
    for (const b of [0.16, 0.12, 0.08, 0.04]) { if (g.grid.segmentClear(this.base.x, this.base.z, this.base.x - this.dir.x * (b + 0.1), this.base.z - this.dir.z * (b + 0.1), true)) { this.maxBack = b; break; } }
    this.floorY = p.pos.y;
    this.bloodI = 0; this.blood.seed = (Math.random() * 1e9) >>> 0; this.blood.clear();
    const m = creature.m;
    m.deathPose.reset(); m.deathPose.on = true;
    m.play('roar', 0.1, { restart: true, timeScale: 1.5 });
    g.hud.el.hud.style.opacity = '0';
    if (!this.light) { this.light = new THREE.PointLight(0xcfe8d8, 0, 7, 2); g.scene.add(this.light); }
    // o corpo ja nasce na pose/posicao da cena (a cabeca "velha" nao pode puxar a primeira mirada: no coop ela pode estar em outro lugar)
    this._creature(sampleDeath(0));
    m.update?.(1e-4, this.floorY, g.time);
    this.update(0);
  }

  // chamado a cada quadro de jogo, DEPOIS de ai.update e ANTES do model.update (dt real, sem a congelada)
  update(dt) {
    if (this.t < 0 || this.finished) return;
    this.t += dt;
    const t = this.t, s = this.s = sampleDeath(t), g = this.game;
    this._camera(dt, s);
    this._creature(s);
    this._extras(dt, s);
    if (t >= DEATH.endT) { this.finished = true; this.blood.fadeOut(); }
  }

  _camera(dt, s) {
    const g = this.game, cam = g.camera, m = this.creature.m, t = this.t;
    m.headWorld(this.head);
    if (this.first) { this.headS.copy(this.head); this.first = false; } else this.headS.lerp(this.head, 1 - Math.exp(-(8 + 24 * s.track) * dt));      // altura/ponto suavizados: o tremor do corpo nao balanca a camera inteira
    const pos = this.pos.copy(this.base);
    pos.addScaledVector(this.dir, Math.max(s.along, -this.maxBack));
    pos.y += s.liftK * clamp(this.headS.y - 0.05 - this.base.y, 0, 0.35);
    this.eye.copy(pos);                                                      // onde estariam os olhos do jogador, sem a puxada da boca nem o tremor: e para la que a cabeca dela mira
    if (s.bite > 0) pos.lerp(this.head, s.bite * 0.85);                       // puxada para dentro da boca
    const calm = 1 - 0.8 * s.bite;                                           // no bote final o tremor de rotacao quase some: so a puxada para a boca
    const tr = s.trauma * s.trauma, n = (a, b, p) => Math.sin(t * a + p) * 0.65 + Math.sin(t * b + p * 2.1) * 0.35;
    pos.x += n(61, 97, 0.3) * 0.045 * tr * (1 - 0.5 * s.bite); pos.y += n(53, 89, 1.7) * 0.05 * tr * (1 - 0.5 * s.bite); pos.z += n(67, 101, 2.9) * 0.045 * tr * (1 - 0.5 * s.bite);
    const aim = this.tmp.copy(this.headS).lerp(this.head, 0.3 * (1 - s.bite));      // no bote final so o ponto suavizado (a cabeca mergulha e puxaria a mira)
    // a mira parte do ponto SEM a puxada da boca: colada na cabeca a direcao ficaria instavel e a camera giraria feito louca
    const dx = aim.x - this.eye.x, dz = aim.z - this.eye.z, dy = aim.y - this.eye.y;
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.max(0.05, Math.hypot(dx, dz)));
    // parte do olhar que o jogador tinha: se ela veio por tras, ele gira de uma vez (sem corte seco) e ja a encontra la
    const whip = 18 * (1 - S(0, 0.3, t));
    this.yaw += angleDiff(this.yaw, wantYaw) * (1 - Math.exp(-(14 + 16 * s.track + whip) * dt * (1 - 0.55 * s.bite))); this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-(12 + 18 * s.track + whip) * dt * (1 - 0.55 * s.bite)));
    cam.position.copy(pos);
    cam.rotation.set(this.pitch - 0.14 * s.kick + n(57, 91, 0.9) * 0.05 * tr * calm, this.yaw + n(49, 83, 2.2) * 0.06 * tr * calm, s.roll + n(71, 103, 1.1) * 0.07 * tr * calm, 'YXZ');
    if (Math.abs(cam.fov - s.fov) > 0.01) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
  }

  _creature(s) {
    const g = this.game, c = this.creature, m = c.m, cam = g.camera;
    // malha fechada no rosto: o pivo dela anda para a cabeca ficar a faceTarget dos olhos, seja qual for a dobra do momento
    const piv = m.group.position;                                                                  // pivo REAL do modelo (no coop o snapshot reescreve creature.pos a cada quadro)
    const hf = (this.head.x - piv.x) * this.dir.x + (this.head.z - piv.z) * this.dir.z;             // quanto a cabeca esta a frente do pivo (para o jogador = negativo)
    const d = lerp(this.d0, clamp(Math.max(this.s.along, -this.maxBack) + s.faceTarget - hf, 0.5, 1.9), s.dist);
    c.pos.set(this.base.x + this.dir.x * d, this.floorY, this.base.z + this.dir.z * d);
    c.yaw = Math.atan2(-this.dir.x, -this.dir.z);
    c.moveSpeed = 0;
    m.group.position.copy(c.pos); m.group.rotation.y = c.yaw;
    m.lookTarget = this.eye; m.lookWeight = 1;
    m.eyeshine = 0.55 + 0.4 * S(0.3, 0.8, this.t);
    // maos: nos ombros do jogador (a mao esquerda da criatura fica do lado direito da camera: ela olha de frente)
    this.right.set(-this.dir.z, 0, this.dir.x);                               // direita da camera (olhando para a criatura)
    const dp = m.deathPose;
    dp.on = true; dp.fold = s.fold; dp.neck = s.neck; dp.reach = s.reach; dp.shake = s.shake; dp.sink = 0; dp.tilt = s.tilt; dp.splay = s.splay;
    for (let i = 0; i < 2; i++) dp.hands[i].copy(cam.position).addScaledVector(this.right, i === 0 ? 0.2 : -0.2).addScaledVector(this.dir, 0.2).y -= 0.02;
    dp.grab.copy(cam.position).addScaledVector(this.dir, -0.1).y -= 0.04;                // os dedos apontam para tras do crânio do jogador
  }

  _extras(dt, s) {
    const g = this.game, t = this.t, fl = g.flashlight, cam = g.camera;
    // lanterna: treme, pisca e morre no bote final
    if (t > 0.3) {
      const k = t > DEATH.biteT + 0.25 ? 0 : (Math.random() < 0.22 ? 0.12 : 1);
      fl.spot.intensity *= k; fl.fill.intensity *= k;
      const j = s.trauma * s.trauma * 0.12;
      fl.holder.rotation.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, 0);
    }
    // luz da cena: garante o rosto visivel mesmo sem lanterna, e vira vermelha no fim
    if (this.light) {
      const strobe = t > 0.78 && t < 1.7 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 38)) : 1;
      this.light.intensity = s.light * strobe;
      this.light.color.setRGB(lerp(0.81, 1, s.flashRed), lerp(0.91, 0.25, s.flashRed), lerp(0.85, 0.2, s.flashRed));
      this.light.position.copy(cam.position).addScaledVector(this.dir, 0.1).y -= 0.3;       // luz de baixo para cima: o rosto fica mais macabro
    }
    // sangue
    while (this.bloodI < BLOOD_EVENTS.length && t >= BLOOD_EVENTS[this.bloodI][0]) {
      const [, n, r0, r1] = BLOOD_EVENTS[this.bloodI++];
      for (let i = 0; i < n; i++) this.blood.splat(0.12 + Math.random() * 0.76, 0.35 + Math.random() * 0.55, lerp(r0, r1, Math.random()));
    }
    this.blood.update(dt);
  }

  // uniformes do pos-processamento (depois do resto do quadro, para ninguem sobrescrever)
  applyFx(u) {
    if (this.t < 0) return;
    const s = this.s;
    u.pulse.value = s.pulse; u.shock.value = s.shock; u.tunnel.value = s.tunnel;
    u.flash.value = s.flash; u.flashColor.value.setRGB(1, lerp(0.86, 0.3, s.flashRed), lerp(0.8, 0.25, s.flashRed));
    u.fade.value = s.fade; u.fadeColor.value.setRGB(0, 0, 0);
  }

  // volta ao normal (tentar de novo, hardcore, virar espirito, voltar ao menu)
  reset() {
    const g = this.game;
    if (this.t >= 0 || this.light) {
      g.camera.fov = this.baseFov || DEATH.fov; g.camera.updateProjectionMatrix();
      const u = g.post.uniforms; u.shock.value = 0; u.flash.value = 0; u.tunnel.value = 0; u.pulse.value = 0; u.fade.value = 0;
      g.hud.el.hud.style.opacity = '';
      g.flashlight.holder.rotation.set(0, 0, 0);
      this.creature?.m.deathPose.reset();
      if (this.light) { g.scene.remove(this.light); this.light.dispose?.(); this.light = null; }
    }
    this.blood.remove();
    this.t = -1; this.finished = false; this.creature = null;
  }
}
