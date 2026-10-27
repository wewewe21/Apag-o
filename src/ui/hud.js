// HUD minimo e telas (DOM). O jogo e lido pelo mundo; o HUD so confirma o essencial.
import { NOTES } from './notes.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), prompt: $('prompt'), toast: $('toast'), objective: $('objective'),
      fuses: $('fuses'), key: $('keyIcon'), battery: $('battery'), batFill: $('batFill'), heat: $('heat'),
      stamina: $('stamina'), breath: $('breath'), breathFill: $('breathFill'), burn: $('burn'),
      hold: $('hold'), holdFill: $('holdFill'), cross: $('cross'), charge: $('charge'), chargeFill: $('chargeFill'),
    };
    this.toastT = 0; this.objT = 0; this.batT = 0; this.burnV = 0;
  }

  show(on) { this.el.hud.hidden = !on; }

  prompt(text, key = 'E') {
    const p = this.el.prompt;
    if (!text) { p.hidden = true; this.el.cross.classList.remove('active'); return; }
    p.hidden = false;
    p.innerHTML = key ? `<kbd>${key}</kbd> ${text}` : text;
    this.el.cross.classList.add('active');
  }

  toast(text, secs = 3.2) {
    const t = this.el.toast;
    t.textContent = text; t.hidden = false; t.classList.remove('fade'); void t.offsetWidth; t.classList.add('show');
    this.toastT = secs;
  }

  objective(text, secs = 6) {
    this.el.objective.textContent = text;
    this.el.objective.classList.add('show');
    this.objT = secs;
  }

  burnMeter(v) { this.burnV = Math.max(0, Math.min(1, v)); }
  holdMeter(v) { this.el.hold.hidden = v <= 0; this.el.holdFill.style.width = (v * 100).toFixed(0) + '%'; }

  update(dt) {
    const g = this.game, p = g.player, fl = g.flashlight;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show'); }
    if (this.objT > 0) { this.objT -= dt; if (this.objT <= 0) this.el.objective.classList.remove('show'); }
    // fusiveis carregados (em risco) / instalados
    const carried = p.inventory.fuses.length, installed = g.objectives.installed.length;
    this.el.fuses.innerHTML = Array.from({ length: g.fusesTotal }, (_, i) => {
      const cls = i < installed ? 'in' : i < installed + carried ? 'carry' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
    this.el.fuses.title = `${installed} instalados, ${carried} no bolso`;
    this.el.key.hidden = !p.inventory.key;
    // bateria: aparece quando muda ou esta baixa
    const b = fl.battery;
    this.el.batFill.style.width = (b * 100).toFixed(1) + '%';
    this.el.battery.classList.toggle('low', b < g.cfg.FLASHLIGHT.lowBattery);
    this.el.battery.classList.toggle('on', fl.on);
    this.el.heat.style.width = (fl.heat * 100).toFixed(0) + '%';
    this.el.heat.classList.toggle('hot', fl.heat > 0.7 || fl.overheat > 0);
    this.el.heat.parentElement.classList.toggle('visible', fl.heat > 0.02 || fl.overheat > 0);
    // estamina
    this.el.stamina.style.transform = `scaleX(${p.stamina.toFixed(3)})`;
    this.el.stamina.parentElement.classList.toggle('visible', p.stamina < 0.98);
    this.el.stamina.classList.toggle('ex', p.exhausted);
    // respiracao (escondido)
    const hid = !!p.hidden;
    this.el.breath.hidden = !hid;
    if (hid) {
      this.el.breathFill.style.transform = `scaleX(${p.breath.toFixed(3)})`;
      this.el.breath.classList.toggle('holding', p.holdingBreath);
      const ai = g.ai;
      const near = ai && ai.state !== 'dormant' && Math.hypot(ai.pos.x - p.pos.x, ai.pos.z - p.pos.z) < 5.5;
      this.el.breath.classList.toggle('urgent', near);
    }
    // anel de queimadura em volta da mira
    this.burnV = Math.max(0, this.burnV - dt * 0.8);
    this.el.burn.style.setProperty('--v', this.burnV.toFixed(3));
    this.el.burn.hidden = this.burnV <= 0.01;
    // carga da porta
    const o = g.objectives;
    this.el.charge.hidden = !o.charging && !o.doorOpen;
    if (o.charging || o.doorOpen) this.el.chargeFill.style.width = (o.charge * 100).toFixed(1) + '%';
  }

  // ---------- telas ----------
  openNote(id) {
    const n = NOTES[id];
    if (!n) return;
    $('noteTitle').textContent = n.title;
    $('noteMeta').textContent = n.meta;
    const body = n.dynamic ? n.dynamic(this.game.fuseHints) : n.body;       // algumas notas mudam a cada partida (onde estao os fusiveis)
    $('noteBody').innerHTML = body.map(p => `<p>${p}</p>`).join('') + (n.hand ? `<p class="hand">${n.hand}</p>` : '');
    $('note').hidden = false;
  }
  closeNote() { $('note').hidden = true; }

  openMap(canvas, player, installed) {
    const holder = $('mapCanvas');
    holder.innerHTML = '';
    holder.appendChild(canvas);
    $('map').hidden = false;
  }
  closeMap() { $('map').hidden = true; }
}
