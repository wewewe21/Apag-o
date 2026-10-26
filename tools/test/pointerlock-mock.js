// Simulador do Pointer Lock do Chrome para testar o gerenciador de entrada sem depender do navegador.
// Regras imitadas: precisa de gesto do usuario (5 s), Esc bloqueia novo pedido por ~1,3 s (SecurityError),
// sem foco/aba oculta falha, sair por codigo (exitPointerLock) libera o proximo pedido sem gesto.
// Uso (console): await import('/tools/test/pointerlock-mock.js'); window.PLM.userEsc(); PLM.blurExit(); ...
const m = { el: null, activeUntil: 0, lastUserExit: -1e9, pageExit: false, log: [], reqs: 0, noFocus: false };
addEventListener('pointerdown', () => { m.activeUntil = performance.now() + 5000; }, true);
addEventListener('keydown', (e) => { if (e.code !== 'Escape') m.activeUntil = performance.now() + 5000; }, true);
Object.defineProperty(document, 'pointerLockElement', { get: () => m.el, configurable: true });
const err = (name, msg) => { const e = new Error(msg); e.name = name; return e; };
HTMLCanvasElement.prototype.requestPointerLock = function () {
  m.reqs++;
  return new Promise((res, rej) => {
    setTimeout(() => {
      const now = performance.now();
      const fail = (name, msg) => { m.log.push('ERR ' + name); document.dispatchEvent(new Event('pointerlockerror')); rej(err(name, msg)); };
      if (m.el === this) return res();
      if (document.hidden || m.noFocus) return fail('InvalidStateError', 'document not focused');
      if (now - m.lastUserExit < 1300) return fail('SecurityError', 'The user has exited the lock before this request was completed.');
      if (!(now < m.activeUntil || m.pageExit)) return fail('NotAllowedError', 'no user gesture');
      m.el = this; m.pageExit = false; m.log.push('LOCK');
      document.dispatchEvent(new Event('pointerlockchange')); res();
    }, 5);
  });
};
document.exitPointerLock = () => { if (!m.el) return; m.el = null; m.pageExit = true; m.log.push('PAGE-UNLOCK'); document.dispatchEvent(new Event('pointerlockchange')); };
m.userEsc = () => { if (!m.el) return; m.el = null; m.lastUserExit = performance.now(); m.log.push('ESC-UNLOCK'); document.dispatchEvent(new Event('pointerlockchange')); };
m.blurExit = () => { if (m.el) { m.el = null; m.log.push('BLUR-UNLOCK'); document.dispatchEvent(new Event('pointerlockchange')); } window.dispatchEvent(new Event('blur')); };
document.hasFocus = () => !m.noFocus;
window.PLM = m;
export default m;
