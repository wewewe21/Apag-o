// Tela "Teclas" do menu de pausa: lista todas as acoes com 2 teclas cada; clique no botao e aperte a nova tecla.
// Tambem atualiza as dicas na tela (data-act="acao") quando o jogador troca uma tecla.
import { ACTIONS, keyLabel } from '../core/keybinds.js';

const $ = (id) => document.getElementById(id);

export class BindsUI {
  // input: Input do jogo; onChange(): chamado depois de qualquer troca (para atualizar outras telas)
  constructor(input, onChange = () => {}) {
    this.input = input; this.onChange = onChange; this.listening = null;
    // em fase de CAPTURA: a tecla apertada nunca chega ao jogo (nada de pausar/retomar ao apertar Esc para cancelar)
    addEventListener('keydown', (e) => {
      if (!this.listening) return;
      e.preventDefault(); e.stopPropagation();
      this._finish(e);
    }, true);
    addEventListener('mousedown', (e) => { if (this.listening && !e.target.closest?.('.bind-btn')) this._cancel(); }, true);
    const reset = $('bindsReset');
    if (reset) reset.onclick = () => { this.input.resetBinds(); this.msg('Teclas restauradas para o padrão.'); this._changed(); };
    this.render(); this.applyLabels();
  }

  msg(text) { const m = $('bindsMsg'); if (m) m.textContent = text || ''; }

  render() {
    const box = $('bindsList'); if (!box) return;
    box.innerHTML = '';
    for (const a of ACTIONS) {
      const row = document.createElement('div'); row.className = 'bind-row';
      const name = document.createElement('span'); name.textContent = a.label; row.appendChild(name);
      for (let slot = 0; slot < 2; slot++) row.appendChild(this._button(a.id, slot));
      box.appendChild(row);
    }
  }

  _button(id, slot) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bind-btn';
    const code = this.input.binds[id]?.[slot] || '';
    b.textContent = keyLabel(code); if (!code) b.classList.add('empty');
    b.title = 'Clique e aperte a nova tecla (Esc cancela, Delete limpa)';
    b.onclick = () => this.listen(id, slot, b);
    return b;
  }

  // chamado tambem pelo botao "Tecla de falar" do painel de voz
  listen(id, slot, btn) {
    this._cancel();
    this.listening = { id, slot, btn };
    btn.classList.add('listening'); btn.textContent = 'Aperte uma tecla…';
    this.msg('');
  }

  _cancel() {
    if (!this.listening) return;
    this.listening = null; this.render(); this.applyLabels();
  }

  _finish(e) {
    const { id, slot } = this.listening; this.listening = null;
    if (e.code === 'Escape') { this.render(); this.applyLabels(); return; }
    const code = e.code === 'Delete' || e.code === 'Backspace' ? '' : e.code;
    const r = this.input.setBind(id, slot, code);
    if (r && r.id) { const other = ACTIONS.find(a => a.id === r.id); this.msg(`A tecla ${keyLabel(code)} estava em “${other.label}” e foi liberada lá.`); }
    else this.msg(code ? '' : 'Tecla removida.');
    this._changed();
  }

  _changed() { this.render(); this.applyLabels(); this.onChange(); }

  // textos na tela que mostram teclas: <kbd data-act="flashlight">; varias acoes separadas por virgula viram "W A S D"
  applyLabels(root = document) {
    for (const el of root.querySelectorAll('[data-act]')) {
      el.textContent = el.dataset.act.split(',').map(id => this.input.label(id)).join(el.dataset.sep ?? ' ');
    }
  }
}
