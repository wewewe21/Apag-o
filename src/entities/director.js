// Diretor de tensao (estilo "menace gauge"): controla o ritmo dos encontros.
// - sobe a tensao quando a criatura esta perto/cacando; no maximo, manda ela embora (respiro)
// - se o jogador passa muito tempo sem ver a criatura, da a ela uma "pista" da regiao do jogador
// - agressividade cresce com os fusiveis instalados; no final ela fica enfurecida
// Funciona com um jogador (solo) ou varios (cooperativo): usa host.targets() e considera sempre o jogador vivo mais proximo.
import * as THREE from 'three';
import { DIRECTOR as D, CREATURE as C } from '../config.js';
import { range, clamp } from '../core/rng.js';

export class Director {
  constructor(game) {
    this.game = game;
    this.menace = 0;
    this.hintT = range(...D.hintEvery);
    this.quietT = 0;
    this.breather = 0;
    this.fuses = 0;
    this.finale = false;
  }

  aggression() { return 1 + this.fuses * D.aggressionPerFuse + (this.finale ? 0.6 : 0); }

  // ponto de interesse para a patrulha: perto da regiao do jogador, com ruido
  biasPoint() {
    if (this.breather > 0) return null;
    const p = this.randomAlivePos();
    if (!p) return null;
    return new THREE.Vector3(p.x + (Math.random() - 0.5) * 16, p.y, p.z + (Math.random() - 0.5) * 16);
  }

  randomAlivePos() {
    const alive = this.game.targets().filter(v => !v.dead);
    if (!alive.length) return null;
    return alive[alive.length === 1 ? 0 : Math.floor(Math.random() * alive.length)].pos;
  }

  update(dt) {
    const g = this.game, ai = g.ai;
    if (!ai || ai.state === 'dormant' || g.state !== 'playing') return;
    const nv = ai.nearestView();
    if (!nv) return;
    const d = Math.hypot(nv.pos.x - ai.pos.x, nv.pos.z - ai.pos.z);
    const sameLevel = Math.abs(ai.pos.y - nv.pos.y) < 2;
    // encontro direto sobe rapido; so estar perto sobe devagar
    const direct = ['chase', 'stalk', 'inspect', 'attack'].includes(ai.state);
    const near = sameLevel && d < 9 && ai.visibleModel !== false;
    if (direct || near) {
      const k = ai.state === 'chase' ? 1.6 : direct ? 1 : 0.3;
      this.menace = clamp(this.menace + D.menaceUp * dt * k, 0, 1.2);
      this.quietT = 0;
    } else { this.menace = Math.max(0, this.menace - D.menaceDown * dt); this.quietT += dt; }

    if (this.breather > 0) this.breather -= dt;

    // tensao no limite: respiro (exceto no final)
    if (!this.finale && this.menace >= D.breatherAt && !['chase', 'attack', 'stunned', 'inspect', 'hesitate'].includes(ai.state)) {
      const dur = range(...D.breatherTime);
      if (ai.retreat(dur)) { this.breather = dur + 10; this.menace = 0.45; g.debug?.log('diretor: respiro'); }
    }

    // pista periodica
    this.hintT -= dt * (1 + this.fuses * 0.15) * (this.finale ? 6 : 1);
    if (this.hintT <= 0 && this.breather <= 0) {
      this.hintT = this.finale ? 5 : range(...D.hintEvery);
      if (['patrol', 'lurk'].includes(ai.state) && (this.quietT > 25 || this.finale)) {
        const p = this.randomAlivePos();
        if (!p) return;
        const a = Math.random() * Math.PI * 2, r = this.finale ? range(2, 6) : range(...D.hintRadius);
        const t = new THREE.Vector3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
        const c = g.grid.randomCellNear(t.x / g.cfg.CELL, t.z / g.cfg.CELL, 0, 2, Math.random);
        if (c) { t.set(g.grid.cx(c[0]), p.y, g.grid.cz(c[1])); ai.hint(t); g.debug?.log('diretor: pista'); }
      }
    }
  }

  setFuses(n) { this.fuses = n; }
  startFinale() { this.finale = true; this.breather = 0; this.hintT = 2; }
}
