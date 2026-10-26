// Controle em primeira pessoa: andar, correr (estamina), agachar, balanco de camera, passos e ruido.
import * as THREE from 'three';
import { PLAYER, NOISE, CELL } from '../config.js';
import { clamp, damp } from '../core/rng.js';
import { footstepSurfaceAt } from '../core/footsteps.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0; this.pitch = 0;
    this.crouch = 0; this.crouchTarget = 0;
    this.stamina = 1; this.exhausted = false; this.staminaDelay = 0;
    this.bob = 0; this.stepAcc = 0; this.eyeY = PLAYER.eyeStand;
    this.hidden = null; this.hideYaw = 0; this.hidePitch = 0;
    this.breath = 1; this.holdingBreath = false; this.gasped = false;
    this.moving = false; this.sprinting = false;
    this.shake = 0; this.fear = 0;
    this.inventory = { fuses: [], key: false, map: false };
    this.lookLock = null;   // quando a criatura agarra o jogador
    this.ghost = false;     // cooperativo: jogador morto = espirito (anda livre, sem interagir, atravessa portas)
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.game.grid.floorY(x, z), z);
    this.yaw = yaw; this.pitch = 0; this.vel.set(0, 0);
    this.crouch = this.crouchTarget = 0;
    this.stamina = 1; this.exhausted = false;
    this.hidden = null; this.breath = 1; this.lookLock = null;
    this.eyeY = PLAYER.eyeStand; this.ghost = false;
  }

  get sens() { return PLAYER.mouseSens * (this.game.prefs.sens ?? 1); }

  update(dt, input) {
    const g = this.game.grid;
    // ---------- olhar ----------
    const inv = this.game.prefs.invertY ? -1 : 1;
    if (this.lookLock) {
      // camera travada olhando para a criatura (morte)
      const d = this.lookLock;
      const tyaw = Math.atan2(-(d.x - this.pos.x), -(d.z - this.pos.z));
      this.yaw += Math.atan2(Math.sin(tyaw - this.yaw), Math.cos(tyaw - this.yaw)) * Math.min(1, dt * 10);
      const dy = d.y - (this.pos.y + this.eyeY), dist = Math.hypot(d.x - this.pos.x, d.z - this.pos.z);
      this.pitch = damp(this.pitch, Math.atan2(dy, dist), 10, dt);
    } else if (this.hidden) {
      this.hideYaw = clamp(this.hideYaw - input.mouse.dx * this.sens, -0.6, 0.6);
      this.hidePitch = clamp(this.hidePitch - input.mouse.dy * this.sens * inv, -0.35, 0.3);
    } else {
      this.yaw -= input.mouse.dx * this.sens;
      this.pitch = clamp(this.pitch - input.mouse.dy * this.sens * inv, -1.45, 1.45);
    }

    if (this.ghost) { this._updateGhost(dt, input); return; }
    if (this.hidden) { this._updateHidden(dt, input); return; }
    if (this.lookLock) { this._applyCamera(dt, 0); return; }

    // ---------- mover ----------
    const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const s = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    if (input.hit('KeyC') || input.hit('ControlLeft')) this.crouchTarget = this.crouchTarget ? 0 : 1;
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const moving = f !== 0 || s !== 0;
    if (wantSprint && moving && this.crouchTarget) this.crouchTarget = 0;
    const canSprint = wantSprint && f > 0 && !this.exhausted && this.stamina > 0.02 && this.crouch < 0.3;
    this.sprinting = canSprint && moving;

    let speed = this.sprinting ? PLAYER.sprint : PLAYER.walk;
    speed = THREE.MathUtils.lerp(speed, PLAYER.crouch, this.crouch);
    if (this.stamina < 0.2 && !this.sprinting) speed *= 0.9;
    const len = Math.hypot(f, s) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // frente = -Z local rotacionado pelo yaw
    const tx = (-sin * f + cos * s) / len * speed * (moving ? 1 : 0);
    const tz = (-cos * f - sin * s) / len * speed * (moving ? 1 : 0);
    this.vel.x = damp(this.vel.x, tx, PLAYER.accel, dt);
    this.vel.y = damp(this.vel.y, tz, PLAYER.accel, dt);

    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
    [nx, nz] = g.collideCircle(nx, nz, PLAYER.radius);
    const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.pos.x = nx; this.pos.z = nz;
    const fy = g.floorY(nx, nz);
    this.pos.y = Math.abs(fy - this.pos.y) > 1 ? fy : damp(this.pos.y, fy, 18, dt);
    this.moving = moved > 0.002;

    // ---------- estamina ----------
    if (this.sprinting && this.moving) {
      this.stamina -= PLAYER.staminaDrain * dt;
      this.staminaDelay = PLAYER.staminaRegenDelay;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; this.game.audio?.gasp(0.7); }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt * (this.crouch > 0.5 ? 1.3 : 1));
      if (this.exhausted && this.stamina > PLAYER.exhaustedUntil) this.exhausted = false;
    }

    // ---------- agachar ----------
    this.crouch = damp(this.crouch, this.crouchTarget, 10, dt);

    // ---------- passos ----------
    const speedNow = Math.hypot(this.vel.x, this.vel.y);
    if (this.moving && speedNow > 0.4) {
      this.bob += dt * speedNow * 2.3;
      this.stepAcc += moved;
      const stride = this.sprinting ? 1.05 : THREE.MathUtils.lerp(0.78, 0.6, this.crouch);
      if (this.stepAcc >= stride) {
        this.stepAcc = 0;
        this._footstep();
      }
    } else {
      this.bob = damp(this.bob, Math.round(this.bob / Math.PI) * Math.PI, 6, dt);
    }
    this._applyCamera(dt, speedNow);
  }

  // espirito: anda sem ruido nem estamina, portas nao o bloqueiam (as paredes sim: nunca sai do predio)
  _updateGhost(dt, input) {
    const g = this.game.grid;
    const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const s = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const speed = input.down('ShiftLeft') || input.down('ShiftRight') ? 5.2 : 3.2;
    const len = Math.hypot(f, s) || 1, moving = f !== 0 || s !== 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.vel.x = damp(this.vel.x, (-sin * f + cos * s) / len * speed * (moving ? 1 : 0), 8, dt);
    this.vel.y = damp(this.vel.y, (-cos * f - sin * s) / len * speed * (moving ? 1 : 0), 8, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
    [nx, nz] = g.collideCircle(nx, nz, PLAYER.radius, { ignore: (b) => b.door && b.door.kind !== 'X' });
    const cx = g.cellX(nx), cy = g.cellY(nz);
    if (g.isFloor(cx, cy) || g.isDoor(cx, cy)) { this.pos.x = nx; this.pos.z = nz; }      // nunca fora do piso valido do predio
    const fy = g.floorY(this.pos.x, this.pos.z);
    this.pos.y = Math.abs(fy - this.pos.y) > 1 ? fy : damp(this.pos.y, fy, 10, dt);
    this.moving = moving; this.sprinting = false;
    this.eyeY = 1.55 + Math.sin(performance.now() / 700) * 0.04;
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  _footstep() {
    const zone = this.game.zoneAtPos(this.pos.x, this.pos.z);
    const water = zone?.water;
    let r = this.sprinting ? NOISE.sprint : this.crouch > 0.5 ? NOISE.crouch : NOISE.walk;
    if (water) r = Math.max(r, this.crouch > 0.5 ? NOISE.water * 0.45 : NOISE.water);
    const surface = footstepSurfaceAt(this.game, this.pos.x, this.pos.z);
    this.game.audio?.footstep(surface, this.sprinting ? 1 : this.crouch > 0.5 ? 0.35 : 0.65);
    this.game.makeNoise(this.pos.x, this.pos.z, r, 'passos');
  }

  _applyCamera(dt, speed) {
    const cam = this.camera;
    const eye = THREE.MathUtils.lerp(PLAYER.eyeStand, PLAYER.eyeCrouch, this.crouch);
    this.eyeY = eye;
    const amp = Math.min(1, speed / PLAYER.sprint) * (this.sprinting ? 0.07 : 0.045);
    const by = Math.abs(Math.sin(this.bob)) * amp;
    const bx = Math.cos(this.bob) * amp * 0.6;
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const shx = (Math.random() - 0.5) * sh * 0.05, shy = (Math.random() - 0.5) * sh * 0.05;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    cam.position.set(this.pos.x + cos * bx + shx, this.pos.y + eye + by + shy, this.pos.z - sin * bx);
    cam.rotation.set(this.pitch + shy * 0.5, this.yaw, Math.cos(this.bob) * amp * 0.25 + shx * 0.3, 'YXZ');
  }

  // ---------- escondido ----------
  enterHide(spot) {
    this.hidden = spot; this.hideYaw = 0; this.hidePitch = spot.type === 'bed' ? 0.05 : 0;
    this.breath = 1; this.holdingBreath = false; this.gasped = false;
    this.vel.set(0, 0);
    this.crouchTarget = 0; this.crouch = 0;
  }
  exitHide() {
    const spot = this.hidden;
    this.hidden = null;
    const g = this.game.grid;
    let [x, z] = g.collideCircle(spot.exitPos.x, spot.exitPos.z, PLAYER.radius);
    this.pos.set(x, g.floorY(x, z), z);
    this.yaw = spot.yaw; this.pitch = 0;
    if (spot.type === 'bed') { this.crouchTarget = 1; this.crouch = 1; }
  }

  _updateHidden(dt, input) {
    const spot = this.hidden;
    const wasHolding = this.holdingBreath;
    this.holdingBreath = input.down('Space') && this.breath > 0 && !this.gasped;
    if (this.holdingBreath) {
      this.breath -= dt / this.game.cfg.HOLD_BREATH;
      if (this.breath <= 0) {
        this.breath = 0; this.holdingBreath = false; this.gasped = true;
        this.game.audio?.gasp(1);
        this.game.makeNoise(this.pos.x, this.pos.z, NOISE.gasp, 'arfar');
        this.game.onPlayerGasp?.();
      }
    } else {
      this.breath = Math.min(1, this.breath + dt * 0.22);
      if (this.gasped && this.breath > 0.4) this.gasped = false;
    }
    if (wasHolding !== this.holdingBreath) this.game.audio?.setBreathHold(this.holdingBreath);
    const cam = this.camera;
    cam.position.copy(spot.camPos);
    // spot.yaw aponta "para longe" do lado livre; quem esta escondido olha para FORA (pela porta do armario / pela lateral da cama): +PI
    const yaw = spot.yaw + Math.PI + this.hideYaw;
    cam.rotation.set(this.hidePitch, yaw, 0, 'YXZ');
    this.pos.set(spot.x, spot.base, spot.z);
  }

  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }
}
