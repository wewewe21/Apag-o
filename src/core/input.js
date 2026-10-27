// Teclado + mouse com pointer lock (e modo "arrastar para olhar" so quando o pointer lock NAO existe).
//
// Regras do Pointer Lock respeitadas aqui:
//  - so e pedido a partir de uma acao do usuario (clique/tecla) ou logo depois dela;
//  - um erro transitorio (Esc seguido de outro pedido, aba sem foco, gesto expirado) NAO desliga o
//    pointer lock para sempre: o jogo mostra "clique para capturar" e tenta de novo no proximo clique;
//  - ao perder o foco/travamento todo estado de teclas e botoes e limpo (nada de movimento preso).
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();     // apertadas neste quadro
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false };
    this.locked = false;
    this.dragLook = false;        // fallback: so quando o navegador nao oferece pointer lock
    this.enabled = false;
    this.lockSupported = typeof el.requestPointerLock === 'function';
    this._dragging = false;
    this._pending = null;         // promessa do pedido em andamento (evita pedidos duplicados)
    this._ignoreMoveUntil = 0;    // descarta deltas logo depois de (re)travar: alguns navegadores mandam picos
    this._hardFails = 0;
    if (!this.lockSupported) this.dragLook = true;

    addEventListener('keydown', (e) => {
      // com o jogo capturado, o teclado e do jogo: Ctrl+tecla, Alt, F-teclas nao chegam ao navegador (nem nas repeticoes)
      if (this._ownsKeys(e)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.enabled && ['Space', 'Tab', 'KeyF', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      if (this._ownsKeys(e)) e.preventDefault();      // soltar Alt sozinho tambem abre o menu do navegador
      this.keys.delete(e.code); this.released.add(e.code);
    });
    // Ctrl + roda do mouse daria zoom na pagina
    addEventListener('wheel', (e) => { if (e.ctrlKey && this.locked) e.preventDefault(); }, { passive: false });
    // perdeu o foco (Alt+Tab, troca de aba, clique fora): solta tudo para nao ficar andando sozinho
    addEventListener('blur', () => this.clearState());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clearState(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      // o clique que so serve para recapturar o mouse nao vira acao de jogo
      if (!this.locked && !this.dragLook) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      if (this.dragLook) this._dragging = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      this._dragging = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || (this.dragLook && this._dragging)) {
        if (performance.now() < this._ignoreMoveUntil) return;
        // alguns navegadores mandam picos enormes ao travar o ponteiro
        if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => this._syncLock());
    document.addEventListener('pointerlockerror', () => { /* tratado em requestLock(); um erro isolado nao muda o modo */ });
  }

  // O jogo e dono do teclado? Sim enquanto o mouse esta capturado (Esc sempre devolve o controle ao navegador).
  // Sem pointer lock (modo arrastar) so seguramos combinacoes com Ctrl/Alt/Meta, e nunca dentro de campos de texto.
  _ownsKeys(e) {
    if (e.code === 'Escape' || e.code === 'F11' || e.code === 'F12') return false;
    if (this.locked) return true;
    if (!this.enabled || !this.dragLook || !(e.ctrlKey || e.altKey || e.metaKey)) return false;
    const t = e.target, tag = t && t.tagName;
    return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable));
  }

  // Keyboard Lock API (Chrome/Edge): em tela cheia entrega ao jogo ate atalhos reservados, como Ctrl+W.
  // Esc fica de fora de proposito: e a saida. Se o navegador nao suportar, o preventDefault acima ja cobre o resto.
  _keyboardLock(on) {
    const kb = navigator.keyboard;
    if (!kb || typeof kb.lock !== 'function') return;
    try {
      if (on) {
        const p = kb.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyT', 'KeyN',
          'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'Tab', 'Space',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
        if (p && p.catch) p.catch(() => { /* sem tela cheia / sem suporte: segue so com preventDefault */ });
      } else kb.unlock();
    } catch { /* ok */ }
  }

  // reflete o estado real do navegador; e idempotente (o evento e o fim da promessa podem chegar em qualquer ordem)
  _syncLock() {
    const now = document.pointerLockElement === this.el;
    if (now === this.locked) return;
    this.locked = now;
    this._keyboardLock(now);
    if (now) { this.dragLook = !this.lockSupported; this._ignoreMoveUntil = performance.now() + 120; this._hardFails = 0; }
    else this.clearState();
    if (this.onLockChange) this.onLockChange(this.locked);
  }

  // solta teclas, botoes e deltas pendentes (perda de foco, pausa, troca de aba)
  clearState() {
    this.keys.clear(); this.pressed.clear(); this.released.clear();
    this.mouse.left = this.mouse.right = this.mouse.leftPressed = this.mouse.rightPressed = false;
    this.mouse.dx = this.mouse.dy = 0;
    this._dragging = false;
  }

  // Pede o pointer lock. Resolve true se travou. Deve ser chamado de dentro de um gesto do usuario
  // (clique/tecla) ou logo depois; se o navegador recusar por causa do gesto/recarga do Esc,
  // repete por alguns segundos enquanto a ativacao do usuario ainda vale.
  requestLock() {
    if (this.dragLook) return Promise.resolve(false);
    if (this.locked) return Promise.resolve(true);
    if (this._pending) return this._pending;
    const gaps = [0, 260, 440, 600, 800, 1100];      // ~3,2 s no total, dentro da janela de ativacao do gesto
    const run = async () => {
      let unadjusted = true;
      for (const d of gaps) {
        if (d) await new Promise(r => setTimeout(r, d));
        this._syncLock();
        if (this.locked) return true;
        if (document.hidden || !document.hasFocus()) return false;     // sem foco nao adianta insistir
        try {
          const p = this.el.requestPointerLock(unadjusted ? { unadjustedMovement: true } : undefined);
          if (p && typeof p.then === 'function') await p;
          else await new Promise(r => setTimeout(r, 120));
        } catch (err) {
          const name = err && err.name, msg = String((err && err.message) || '');
          if (name === 'NotSupportedError' && unadjusted) { unadjusted = false; continue; }     // sem movimento cru: tenta o normal
          // Bloqueio permanente (iframe sem permissao, documento invalido): insistir nao adianta.
          // "Usuario acabou de sair com Esc" (SecurityError), gesto expirado (NotAllowedError) e falta de foco sao transitorios.
          if (name === 'WrongDocumentError' || name === 'NotSupportedError' || (name === 'SecurityError' && /sandbox|frame|permission/i.test(msg))) {
            this._hardFails++;
            if (this._hardFails >= 2) { this.dragLook = true; this.onLockError?.(); }
            return false;
          }
        }
        this._syncLock();
        if (this.locked) return true;
        // ainda pode ser um pedido aceito cujo evento chega a seguir
        await new Promise(r => setTimeout(r, 30));
        this._syncLock();
        if (this.locked) return true;
      }
      return false;
    };
    this._pending = run().finally(() => { this._pending = null; });
    return this._pending;
  }

  exitLock() { try { document.exitPointerLock(); } catch { /* ok */ } }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  up(code) { return this.released.has(code); }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = false;
  }
}
