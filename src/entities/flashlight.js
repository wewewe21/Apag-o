// Lanterna: feixe normal (explorar) e foco (botao direito) que queima o rosto da criatura.
// Limites: bateria, aquecimento do foco, alcance, cone estreito, precisao no rosto.
import * as THREE from 'three';
import { FLASHLIGHT as F } from '../config.js';
import { flashlightCookie } from '../world/textures.js';
import { clamp, damp, lerp } from '../core/rng.js';

export class Flashlight {
  constructor(game, quality) {
    this.game = game;
    const cam = game.camera;
    this.spot = new THREE.SpotLight(0xfff1dc, 0, F.distance, F.angle, 0.35, 2);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(quality.shadow, quality.shadow);
    this.spot.shadow.camera.near = 0.15;
    this.spot.shadow.camera.far = F.focusDistance;
    this.spot.shadow.bias = -0.0006;
    this.spot.shadow.normalBias = 0.02;
    this.spot.map = flashlightCookie();
    // luz na mao, um pouco a direita e abaixo dos olhos
    this.holder = new THREE.Object3D();
    cam.add(this.holder);
    this.holder.position.set(0.16, -0.2, -0.05);
    this.holder.add(this.spot);
    this.spot.position.set(0, 0, 0);
    this.target = new THREE.Object3D();
    this.holder.add(this.target);
    this.target.position.set(0, 0, -1);
    this.spot.target = this.target;
    // preenchimento: um pouco de luz rebatida em volta do jogador
    this.fill = new THREE.PointLight(0xd8e0ff, 0, 5, 2);
    cam.add(this.fill); this.fill.position.set(0, 0.1, 0.3);

    this.on = false; this.focus = 0; this.battery = F.battery; this.heat = 0;
    this.overheat = 0; this.flick = 1; this.shakeBoost = 0; this.dead = false;
    this.sway = new THREE.Vector2();
    this._dir = new THREE.Vector3(); this._pos = new THREE.Vector3();
    this.burnTarget = 0;   // 0..1 exposicao do rosto, mostrado no HUD
  }

  toggle() {
    if (this.overheat > 0 || this.battery <= 0) { this.game.audio?.click(false); return; }
    this.on = !this.on;
    this.game.audio?.click(this.on);
    this.game.makeNoise(this.game.player.pos.x, this.game.player.pos.z, 2.5, 'clique');
  }

  update(dt, input, blocked) {
    if (!blocked) {
      if (input.actHit('flashlight')) this.toggle();
      if (input.actHit('battery') && this.on && this.battery < F.lowBattery * 1.5) {
        // bater a lanterna: recupera o feixe por alguns segundos
        this.shakeBoost = 2.5; this.game.audio?.thump();
      }
    }
    const wantFocus = !blocked && input.mouse.right && this.on && this.overheat <= 0 && this.battery > 0;
    this.focus = clamp(this.focus + (wantFocus ? dt / F.focusChargeTime : -dt / 0.12), 0, 1);

    if (this.overheat > 0) {
      this.overheat -= dt;
      if (this.overheat <= 0) this.game.hud?.toast('A lanterna esfriou.');
    }
    this.heat = clamp(this.heat + (this.focus > 0.05 ? F.heatPerSec * this.focus : -F.coolPerSec) * dt, 0, 1);
    if (this.heat >= 1 && this.overheat <= 0) {
      this.overheat = F.overheatLock; this.on = false; this.focus = 0;
      this.game.audio?.overheat();
      this.game.hud?.toast('Lâmpada superaquecida!');
    }
    if (this.on) {
      this.battery = Math.max(0, this.battery - (F.drainOn + F.drainFocus * this.focus) * dt);
      if (this.battery <= 0) { this.on = false; this.game.hud?.toast('Bateria esgotada. Procure pilhas.'); this.game.audio?.click(false); }
    }
    this.game.audio?.setFlashlightHum(this.on ? this.focus : 0, this.heat);

    // piscadas com bateria fraca
    this.shakeBoost = Math.max(0, this.shakeBoost - dt);
    let flick = 1;
    if (this.on && this.battery < F.lowBattery && this.shakeBoost <= 0) {
      const t = performance.now() / 1000;
      const k = 1 - this.battery / F.lowBattery;
      flick = Math.sin(t * 13.7) + Math.sin(t * 5.3) > 1.6 - k ? 0.1 : 1 - k * 0.45;
    }
    if (this.game.creatureNear && this.on) {
      // a criatura por perto faz a lampada tremer
      const n = this.game.creatureNear;
      if (Math.random() < n * 0.08) flick *= 0.3;
    }
    this.flick = damp(this.flick, flick, 25, dt);

    // balanco: o feixe acompanha a camera com leve atraso
    const mdx = input.mouse.dx * 0.0006, mdy = input.mouse.dy * 0.0006;
    this.sway.x = damp(this.sway.x + mdx, 0, 7, dt);
    this.sway.y = damp(this.sway.y + mdy, 0, 7, dt);
    this.target.position.set(this.sway.x * 1.2 - 0.02, -this.sway.y * 1.2 + 0.03, -1);

    const on = this.on && !this.game.player?.hidden ? 1 : 0;   // dentro do esconderijo o feixe nao sai (ofuscava contra a porta)
    this.spot.angle = lerp(F.angle, F.focusAngle, this.focus);
    this.spot.penumbra = lerp(0.45, 0.2, this.focus);
    this.spot.distance = lerp(F.distance, F.focusDistance, this.focus);
    this.spot.intensity = on * lerp(F.intensity, F.focusIntensity, this.focus) * this.flick * (0.55 + 0.45 * Math.min(1, this.battery / 0.3));
    this.spot.color.setHSL(0.1, lerp(0.35, 0.15, this.focus), 0.9);
    this.fill.intensity = on * 0.35 * this.flick;
  }

  // origem e direcao reais do feixe
  beam() {
    this.spot.getWorldPosition(this._pos);
    const tp = this.target.getWorldPosition(new THREE.Vector3());
    this._dir.copy(tp).sub(this._pos).normalize();
    return { pos: this._pos, dir: this._dir, angle: this.spot.angle, range: this.spot.distance, on: this.on && this.spot.intensity > 1, focus: this.focus };
  }

  // quanto a lanterna ilumina um ponto (0..1), sem checar oclusao
  illum(p, rangeOverride) {
    if (!this.on || this.spot.intensity < 1) return 0;
    const b = this.beam();
    const v = p.clone().sub(b.pos);
    const d = v.length();
    const range = rangeOverride ?? b.range;
    if (d > range) return 0;
    const c = v.normalize().dot(b.dir);
    const cosA = Math.cos(b.angle);
    if (c < cosA) return 0;
    return clamp((c - cosA) / (1 - cosA) * 2.5, 0, 1) * (1 - d / range) * this.flick;
  }
}
