// Teclas do jogo: cada ACAO tem ate 2 teclas (codigos de tecla fisica, como "KeyW"), configuraveis e guardadas no navegador.
// O resto do codigo pergunta pela acao (input.act('flashlight')), nunca pela tecla; assim o jogador pode trocar tudo.
// Fica de fora (fixo): Esc (pausa / soltar o mouse) e os botoes do mouse (esquerdo = interagir com a mira, direito = foco da lanterna).

export const ACTIONS = [
  { id: 'forward', label: 'Andar para frente', def: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Andar para trás', def: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Andar para a esquerda', def: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Andar para a direita', def: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Correr', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'crouch', label: 'Agachar', def: ['KeyC', 'ControlLeft'] },
  { id: 'flashlight', label: 'Lanterna', def: ['KeyF', ''] },
  { id: 'battery', label: 'Bater a lanterna', def: ['KeyR', ''] },
  { id: 'interact', label: 'Interagir / esconder-se', def: ['KeyE', ''] },
  { id: 'breath', label: 'Prender a respiração', def: ['Space', ''] },
  { id: 'objective', label: 'Mostrar objetivo', def: ['Tab', ''] },
  { id: 'map', label: 'Planta do prédio', def: ['KeyM', ''] },
  { id: 'ptt', label: 'Falar (apertar para falar)', def: ['KeyV', ''] },
];

export const RESERVED = new Set(['Escape']);          // nunca podem ser atribuidas
const STORE = 'apagao.binds.v1';

export const defaultBinds = () => Object.fromEntries(ACTIONS.map(a => [a.id, [...a.def]]));

// junta o que estava guardado com os padroes (acoes novas aparecem sozinhas; lixo e ignorado)
export function loadBinds(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const b = defaultBinds();
  try {
    const saved = JSON.parse(storage?.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      for (const a of ACTIONS) {
        const s = saved[a.id];
        if (Array.isArray(s)) b[a.id] = [0, 1].map(i => (typeof s[i] === 'string' && !RESERVED.has(s[i]) && s[i].length < 24 ? s[i] : ''));
      }
    }
  } catch { /* sem storage ou JSON ruim: padroes */ }
  return b;
}
export function saveBinds(binds, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { storage?.setItem(STORE, JSON.stringify(binds)); } catch { /* sem armazenamento */ }
}

// atribui `code` ao slot (0 ou 1) da acao. A mesma tecla nunca fica em duas acoes: e tirada da outra (devolve o que foi desfeito).
export function assign(binds, id, slot, code) {
  if (!binds[id] || RESERVED.has(code)) return null;
  let taken = null;
  if (code) for (const a of ACTIONS) for (let i = 0; i < 2; i++) {
    if (binds[a.id][i] === code && !(a.id === id && i === slot)) { binds[a.id][i] = ''; taken = { id: a.id, slot: i }; }
  }
  binds[id][slot] = code || '';
  return taken || {};
}

const NAMES = {
  Space: 'Espaço', ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.',
  AltLeft: 'Alt esq.', AltRight: 'Alt dir.', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'Page Up', PageDown: 'Page Down', NumpadEnter: 'Enter (num.)', NumpadAdd: '+ (num.)', NumpadSubtract: '- (num.)',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return m[1] + ' (num.)';
  m = /^F(\d{1,2})$/.exec(code); if (m) return code;
  return code;
}
