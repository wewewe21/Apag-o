// Logica pura das portas (sem three.js): usada pelo cliente (Door, com malha) e pelo servidor (sala multiplayer).
// Guarda estado (aberta/alvo/trancada/emperrada), caixa de colisao/visao no grid e o avanco da animacao.
import { CELL } from '../config.js';

export const DOOR_JAM = 0.09;

export class DoorCore {
  constructor(grid, x, y, kind) {
    this.grid = grid;
    this.x = x; this.y = y; this.kind = kind;
    this.axis = grid.doorAxis(x, y);
    this.cells = [[x, y]];
    if (kind === 'X') this.cells.push([x + 1, y]);
    this.open = 0; this.target = 0; this.dir = 1; this.speed = 2.4;
    this.locked = kind === 'K';
    this.jammed = kind === 'J';
    this.exit = kind === 'X';
    this.base = grid.levelBase(x, y);

    const cx = grid.cx(x), cz = grid.cz(y);
    const width = (kind === 'X' ? 2 : 1) * CELL - 2 * DOOR_JAM;
    this.width = width;
    // centro da abertura
    this.cx = kind === 'X' ? (x + 1) * CELL : cx;
    this.cz = cz;
    const half = 0.06;
    this.box = this.axis === 'h'
      ? { x0: this.cx - width / 2, x1: this.cx + width / 2, z0: cz - half, z1: cz + half, vision: true, door: this }
      : { x0: cx - half, x1: cx + half, z0: cz - width / 2, z1: cz + width / 2, vision: true, door: this };
    grid.addBox(this.box);
    for (const [a, b] of this.cells) grid.doors.set(grid.idx(a, b), this);
  }

  // volta ao estado inicial da partida (fechada, trancada/emperrada conforme o tipo)
  resetState() {
    this.open = 0; this.target = 0; this.dir = 1; this.speed = 2.4;
    this.locked = this.kind === 'K'; this.jammed = this.kind === 'J'; this.exit = this.kind === 'X';
  }

  blocking() { return this.open < 0.72; }
  creaturePassable() { return !this.exit && !this.locked && !this.jammed; }

  // de que lado da porta esta o ponto? (+1 = lado "positivo" local)
  sideOf(px, pz) {
    return this.axis === 'h' ? (pz >= this.cz ? 1 : -1) : (px >= this.cx ? 1 : -1);
  }

  setOpen(open, fromX, fromZ, fast = false) {
    if (open && this.open < 0.05) {
      // abre para o lado oposto de quem empurra
      const s = this.sideOf(fromX, fromZ);
      this.dir = this.axis === 'h' ? s : -s;
    }
    this.target = open ? 1 : 0;
    this.speed = fast ? 7 : 2.4;
  }

  isOpen() { return this.target > 0.5; }

  // avanca a abertura; devolve true se mudou
  step(dt) {
    if (this.open === this.target) return false;
    const d = this.target - this.open;
    const stepD = this.speed * dt;
    this.open = Math.abs(d) <= stepD ? this.target : this.open + Math.sign(d) * stepD;
    return true;
  }

  // posicao/eixo para aplicar o mesmo estado noutro lado (rede)
  snapshot() { return { open: this.target > 0.5 ? 1 : 0, dir: this.dir, fast: this.speed > 3, locked: this.locked, jammed: this.jammed, exit: this.exit }; }
}
