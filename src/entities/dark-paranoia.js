// Efeitos de percepção locais: nunca criam ruído, colisão ou um alvo para a IA.
import * as THREE from 'three';
import { PLAYER } from '../config.js';

const GRACE = 12, FULL = 60, RELIEF = 8, ROOM_LIGHT = 0.12;
const DANGER = new Set(['chase', 'attack', 'inspect']);

export class DarkParanoia {
  constructor(game) {
    this.game = game;
    this.strength = 0;
    this.darkSeconds = 0;
    this._random = Math.random;
    this._forward = new THREE.Vector3();
    this._projected = new THREE.Vector3();
    this._litPoint = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.name = 'dark-paranoia-shadow';
    this.group.visible = false;
    // Cinza esfumaçado percebido no escuro: preto puro desaparecia sob a granulação.
    // Material sem iluminação, sem emissão/aditivo; não ilumina nada ao redor.
    // Silhueta humana vaga, imóvel, sem rosto, olhos ou anatomia da criatura.
    this.material = new THREE.MeshBasicMaterial({ color: 0x4c5b53, transparent: true, opacity: 0, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.26, 7), this.material);
    body.position.y = 0.65; body.scale.z = 0.64;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), this.material);
    head.position.set(0.015, 1.4, 0); head.scale.y = 1.12;
    this.group.add(body, head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.65, 5), this.material);
      arm.position.set(side * 0.19, 0.9, 0); arm.rotation.z = side * 0.13;
      this.group.add(arm);
    }
    this.reset();
  }

  reset() {
    this.strength = 0;
    this.darkSeconds = 0;
    this._stepWait = 8 + this._random() * 6;
    this._shadowWait = 12 + this._random() * 8;
    this._clearShadow();
    this._stopSteps();
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p || p.dead || p.ghost || ['dying', 'dead', 'ended', 'won'].includes(g.state)) { this.reset(); return; }
    // Menus e situações com pistas vitais não consomem o relógio de alucinações.
    if (g.state !== 'playing' || p.hidden || DANGER.has(g.ai?.state) || g.haunting?.toyActive) {
      this._clearShadow(); this._stopSteps(); return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Evita que um salto de relógio ao voltar a uma aba gere eventos em rajada.
    dt = Math.min(dt, 0.25);
    const light = this._lightAt(p.pos.x, p.pos.z) >= ROOM_LIGHT || this._visibleFlashlight();
    this.darkSeconds = light ? Math.max(0, this.darkSeconds - dt * FULL / RELIEF) : Math.min(FULL, this.darkSeconds + dt);
    this.strength = Math.max(0, (this.darkSeconds - GRACE) / (FULL - GRACE));
    if (light) { this._clearShadow(); this._stopSteps(); return; }

    this._updateShadow(dt);
    if (this.strength > 0.18) {
      this._stepWait -= dt;
      if (this._stepWait <= 0) {
        this._stepWait = 16 + this._random() * 13;
        const pos = this._candidate(false);
        if (pos) g.audio?.library?.play('phantom_step', {
          pos: { x: pos.x, y: pos.y + 0.08, z: pos.z },
          volume: 0.11 + this.strength * 0.055, rate: 0.94 + this._random() * 0.08,
          ref: 1.7, rolloff: 1.1, reverb: 0.16, cooldown: 10, important: false,
        });
      }
    }
    if (this.strength > 0.4 && !this.group.visible) {
      this._shadowWait -= dt;
      if (this._shadowWait <= 0) {
        this._shadowWait = 24 + this._random() * 14;
        this._spawnShadow();
      }
    }
  }

  _lightAt(x, z) {
    // Usa o mapa de luz efetivo (setor energizado, lâmpadas queimadas, paredes).
    const v = this.game.lighting?.lightAt(x, z) ?? 0;
    return Number.isFinite(v) ? v : 0;
  }

  _visibleFlashlight() {
    const f = this.game.flashlight;
    if (!f?.on || f.dead || !(f.battery > 0) || !(f.spot?.intensity > 1) || this.game.player?.hidden) return false;
    // 'on' sozinho não prova que um feixe escondido está iluminando o mundo.
    for (let node = f.spot; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  _clearShadow() {
    this.group.visible = false;
    this.group.removeFromParent();
    this.material.opacity = 0;
    this._shadowT = 0;
    this._shadowDuration = 0;
  }

  _stopSteps() {
    // Um passo falso já iniciado também cede às pistas reais e aos menus online.
    for (const voice of this.game.audio?.library?.voices ?? []) if (voice.id === 'phantom_step') voice.stop(0.05);
  }

  _spawnShadow() {
    const pos = this._candidate(true);
    if (!pos) return false;
    this.group.position.copy(pos);
    this.group.rotation.y = Math.atan2(this.game.camera.position.x - pos.x, this.game.camera.position.z - pos.z);
    this._shadowT = 0;
    this._shadowDuration = 0.75 + this._random() * 0.35;
    this.material.opacity = 0;
    this.group.visible = true;
    this.game.scene.add(this.group);
    return true;
  }

  _updateShadow(dt) {
    if (!this.group.visible) return;
    const g = this.game, pos = this.group.position;
    this._shadowT += dt;
    g.camera.updateMatrixWorld();
    this._projected.copy(pos).y += 1;
    this._projected.project(g.camera);
    // Um olhar direto desfaz a impressão, sem movimento ou interação física.
    const onScreen = Math.abs(this._projected.x) <= 1.08 && Math.abs(this._projected.y) <= 1.05 && this._projected.z > -1 && this._projected.z < 1;
    if (this._shadowT >= this._shadowDuration || !onScreen || Math.abs(this._projected.x) < 0.43 ||
        this._lightAt(pos.x, pos.z) >= ROOM_LIGHT || Math.abs(g.player.pos.y - pos.y) > 0.18 ||
        !g.grid.segmentClear(g.camera.position.x, g.camera.position.z, pos.x, pos.z, true) || this._beamOnShadow(pos)) {
      this._clearShadow(); return;
    }
    const envelope = Math.min(1, this._shadowT / 0.12, (this._shadowDuration - this._shadowT) / 0.24);
    this.material.opacity = (0.38 + this.strength * 0.24) * Math.max(0, envelope);
  }

  _beamOnShadow(pos) {
    if (!this._visibleFlashlight()) return false;
    const f = this.game.flashlight, beam = f.beam?.();
    if (!beam?.on || !this.game.grid.segmentClear(beam.pos.x, beam.pos.z, pos.x, pos.z, true)) return false;
    for (const y of [0.45, 1, 1.4]) {
      this._litPoint.copy(pos).y += y;
      if (f.illum?.(this._litPoint) > 0.06) return true;
    }
    return false;
  }

  _candidate(peripheral) {
    const g = this.game, grid = g.grid, p = g.player, cam = g.camera;
    if (!grid || !cam || !p) return null;
    cam.updateMatrixWorld();
    cam.getWorldDirection(this._forward);
    if (Math.hypot(this._forward.x, this._forward.z) < 0.1) return null;
    const yaw = Math.atan2(this._forward.x, this._forward.z);
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
    for (let i = 0; i < 28; i++) {
      const side = this._random() < 0.5 ? -1 : 1;
      const angle = yaw + side * (peripheral ? halfFov * (0.65 + this._random() * 0.27) : 1.2 + this._random() * 1.65);
      const d = peripheral ? 3.4 + this._random() * 3.6 : 3 + this._random() * 3.5;
      const x = p.pos.x + Math.sin(angle) * d, z = p.pos.z + Math.cos(angle) * d;
      const cx = grid.cellX(x), cy = grid.cellY(z), floor = grid.floorY(x, z);
      if (!grid.isFloor(cx, cy) || grid.char(cx, cy) === '=' || !grid.navWalkable(cx, cy, 'player') ||
          Math.abs(floor - p.pos.y) > 0.18 || this._lightAt(x, z) >= ROOM_LIGHT || !this._reachable(x, z, floor)) continue;
      const pos = new THREE.Vector3(x, floor, z);
      if (peripheral) {
        this._projected.copy(pos).y += 1;
        this._projected.project(cam);
        if (Math.abs(this._projected.x) < 0.55 || Math.abs(this._projected.x) > 0.94 ||
            Math.abs(this._projected.y) > 0.72 || this._projected.z <= -1 || this._projected.z >= 1) continue;
      }
      return pos;
    }
    return null; // Quartos apertados ou sem linha de visão não precisam de uma figura.
  }

  _reachable(x, z, floor) {
    const g = this.game, grid = g.grid, p = g.player.pos, cam = g.camera.position;
    if (!grid.segmentClear(cam.x, cam.z, x, z, true)) return false;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (!Number.isFinite(d) || !Number.isFinite(floor) || d < 0.5) return false;
    const nx = -dz / d * PLAYER.radius, nz = dx / d * PLAYER.radius;
    // Corredor contínuo com a largura do jogador: também rejeita camas e portas fechadas.
    for (const side of [-1, 0, 1]) if (!grid.segmentClear(p.x + nx * side, p.z + nz * side, x + nx * side, z + nz * side, false)) return false;
    const [freeX, freeZ] = grid.collideCircle(x, z, PLAYER.radius);
    if (Math.hypot(freeX - x, freeZ - z) > 0.01) return false;
    for (let s = 0, steps = Math.ceil(d / 0.35); s <= steps; s++) {
      const t = s / steps;
      if (Math.abs(grid.floorY(p.x + dx * t, p.z + dz * t) - floor) > 0.18) return false;
    }
    return true;
  }

  dispose() {
    this.reset();
    this.group.traverse(o => o.geometry?.dispose());
    this.material.dispose();
  }
}
