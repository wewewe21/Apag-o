// Presencas locais: nenhum destes sons chama makeNoise ou altera a criatura.
import { CELL } from '../config.js';
import { loadSave, writeSave } from '../core/save.js';

const range = (a, b, rng) => a + rng() * (b - a);
const DANGER = new Set(['chase', 'attack', 'inspect', 'stalk', 'hesitate']);

export class Haunting {
  constructor(game, random = Math.random) {
    this.game = game;
    this.random = random;
    this.reset();
  }

  reset(saved = {}) {
    this._stopToyAudio();
    this.toySeen = saved?.toySeen === true;
    this.toyActive = false;
    this.toyElapsed = 0;
    this.pendingToy = false;
    this.room = null;
    this.laughter = null;
    this.knockTimer = range(38, 58, this.random);
    this.glassTimer = range(14, 25, this.random);
    this.quietTimer = 0;
    this.game.world?.childWard?.reset();
  }

  saveState() { return { toySeen: this.toySeen }; }

  remember() {
    const g = this.game;
    if (g.mode !== 'normal') return;
    const haunting = this.saveState();
    if (g.lastCheckpoint) g.lastCheckpoint.haunting = haunting;
    const saved = loadSave();
    if (saved) writeSave({ ...saved, haunting });
  }

  _stopToyAudio() { this.game.audio?.library?.stopId('toy_music', 0.08); }

  // Morrer interrompe a aparicao, mas nao apaga a primeira visita.
  interrupt() {
    this._stopToyAudio();
    if (this.toyActive) this.game.world.childWard.update(10);
    this.toyActive = false;
    this.pendingToy = false;
    this.laughter = null;
    this.quietTimer = 12;
  }

  _toySound() {
    const lib = this.game.audio?.library, ward = this.game.world.childWard;
    if (!lib || !this.toyActive) return;
    const existing = [...lib.voices].find(v => v.id === 'toy_music');
    const pos = { x: ward.toy.position.x, y: ward.toy.position.y + 0.18, z: ward.toy.position.z };
    if (existing) lib.moveVoice(existing, pos);
    else {
      const duration = lib.buffers.get('toy_music')?.[0]?.duration ?? 10;
      if (this.toyElapsed < duration - 0.05) lib.play('toy_music', { pos, offset: this.toyElapsed, volume: 0.42, ref: 1.8, reverb: 0.08 });
    }
  }

  update(dt) {
    const g = this.game, p = g.player, ward = g.world.childWard, lib = g.audio?.library;
    this.laughter = null;
    if (!p || !ward) return;
    if (p.dead || p.ghost || ['dying', 'dead', 'ended', 'won', 'lobby', 'title'].includes(g.state)) {
      this.interrupt();
      return;
    }
    if (g.state !== 'playing') { this._stopToyAudio(); return; }
    const zone = g.grid.zoneAt(g.grid.cellX(p.pos.x), g.grid.cellY(p.pos.z));
    const patientWing = zone === 'p' && Math.abs(p.pos.y) < 1.5;
    const danger = DANGER.has(g.ai?.state) && (g.monsterDistance?.() ?? Infinity) < 22;
    this.room = ward.roomAt(p.pos);

    // O corredor volta a sussurrar em todas as visitas. As risadas ficam atras de uma das portas.
    if (patientWing && !p.hidden && !danger) {
      const left = p.pos.x < g.grid.cx(5);
      const row = p.pos.z < g.grid.cz(16) ? 14 : p.pos.z < g.grid.cz(20) ? 18 : 23;
      this.laughter = { pos: { x: g.grid.cx(left ? 2 : 8), y: 0.8, z: g.grid.cz(row) }, volume: this.toyActive ? 0.10 : 0.38 };
    }

    if (!this.toySeen && this.room === ward.hauntedRoomId && !p.hidden) {
      this.toySeen = true;
      this.pendingToy = true;
      this.remember();
      void lib?.ensure('toy_music');
    }
    if (this.pendingToy && !danger && this.room === ward.hauntedRoomId && (!lib || lib.has('toy_music') || lib.failed.has('toy_music'))) {
      this.pendingToy = false;
      this.toyActive = true;
      this.toyElapsed = 0;
      ward.startToy();
      this._toySound();
      this.quietTimer = 18;
    }
    if (this.toyActive) {
      ward.update(dt);
      this.toyElapsed += dt;
      this._toySound();
      if (this.toyElapsed >= 10) { this.toyActive = false; this._stopToyAudio(); }
    }

    // Um acontecimento por vez: os avisos reais do inimigo continuam na frente.
    if (p.hidden || danger || this.toyActive) return;
    this.quietTimer = Math.max(0, this.quietTimer - dt);
    if (this.quietTimer > 0 || (g.paranoia?.strength ?? 0) > 0.55) return;
    this.knockTimer -= dt;
    if (zone === 'm' && Math.abs(p.pos.y) < 1.5) this.glassTimer -= dt;
    if (this.glassTimer <= 0 && zone === 'm') {
      // Proximo das macas; permanece dentro do necroterio, nunca segue o jogador.
      const x = p.pos.x < g.grid.cx(21) ? 18 : 23;
      const pos = { x: g.grid.cx(x) + CELL * 0.3, y: 0.08, z: g.grid.cz(6) - CELL * 0.35 };
      if (lib?.play('morgue_glass', { pos, volume: 0.33, ref: 2.5, reverb: 0.12 })) {
        this.glassTimer = range(48, 80, this.random);
        this.quietTimer = 18;
        if (lib) lib.ghostTimer = Math.max(lib.ghostTimer, 20);
      }
    } else if (this.knockTimer <= 0) {
      const choices = g.world.doorsList.filter(d => {
        const distance = Math.hypot(d.cx - p.pos.x, d.cz - p.pos.z);
        return d.kind !== 'X' && d.open < 0.15 && Math.abs(d.base - p.pos.y) < 1.5 && distance > 2.5 && distance < 11;
      });
      if (!choices.length) { this.knockTimer = 8; return; }
      const d = choices[Math.floor(this.random() * choices.length)];
      if (lib?.play('haunt_door_knock', { pos: { x: d.cx, y: d.base + 1.1, z: d.cz }, volume: 0.30, ref: 2.8, reverb: 0.10 })) {
        this.knockTimer = range(42, 72, this.random);
        this.quietTimer = 18;
        lib.ghostTimer = Math.max(lib.ghostTimer, 20);
      }
    }
  }
}
