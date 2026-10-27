// Teclas configuraveis: padroes, troca, conflito, Esc reservado, guardar/carregar (com lixo no armazenamento) e rotulos.
import { ACTIONS, defaultBinds, loadBinds, saveBinds, assign, keyLabel } from '../../src/core/keybinds.js';

let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.log('FALHA:', m); } };
const fakeStore = (init) => { let v = init; return { getItem: () => v, setItem: (_, x) => { v = x; }, get raw() { return v; } }; };

// padroes = teclas de sempre
const d = defaultBinds();
check(d.forward[0] === 'KeyW' && d.back[0] === 'KeyS' && d.left[0] === 'KeyA' && d.right[0] === 'KeyD', 'WASD continua o padrao');
check(d.sprint.join() === 'ShiftLeft,ShiftRight' && d.crouch.join() === 'KeyC,ControlLeft' && d.interact[0] === 'KeyE' && d.breath[0] === 'Space', 'padroes de correr, agachar, interagir e respirar');
check(d.flashlight[0] === 'KeyF' && d.battery[0] === 'KeyR' && d.objective[0] === 'Tab' && d.map[0] === 'KeyM' && d.ptt[0] === 'KeyV', 'lanterna, bater, objetivo, mapa e falar');

// nenhuma tecla repetida nos padroes e toda acao tem 2 slots
const seen = new Set(); let dup = 0;
for (const a of ACTIONS) { check(d[a.id].length === 2, `${a.id} tem 2 slots`); for (const c of d[a.id]) if (c) { if (seen.has(c)) dup++; seen.add(c); } }
check(dup === 0, 'nenhuma tecla padrao repetida entre acoes');

// trocar uma tecla
const b = defaultBinds();
let r = assign(b, 'flashlight', 0, 'KeyG');
check(b.flashlight[0] === 'KeyG' && !r.id, 'troca simples da lanterna para G');
// conflito: dar a F ja usada pela lanterna... (agora livre) e depois uma usada por outra acao
r = assign(b, 'flashlight', 0, 'KeyE');
check(b.flashlight[0] === 'KeyE' && b.interact[0] === '' && r.id === 'interact', 'a mesma tecla nunca fica em duas acoes: sai da outra');
// segundo slot
assign(b, 'flashlight', 1, 'KeyQ'); check(b.flashlight.join() === 'KeyE,KeyQ', 'cada acao aceita 2 teclas');
// limpar
assign(b, 'flashlight', 1, ''); check(b.flashlight[1] === '', 'limpar um slot');
// Esc e reservado
assign(b, 'map', 0, 'Escape'); check(b.map[0] === 'KeyM', 'Esc nao pode ser atribuido');
check(assign(b, 'naoexiste', 0, 'KeyZ') === null, 'acao inexistente e ignorada');
// trocar para a propria tecla nao se apaga
const c = defaultBinds(); assign(c, 'map', 0, 'KeyM'); check(c.map[0] === 'KeyM', 'reatribuir a mesma tecla mantem');

// guardar e carregar
const st = fakeStore(null);
saveBinds(b, st);
const back = loadBinds(st);
check(back.flashlight.join() === b.flashlight.join() && back.interact[0] === '' && back.forward[0] === 'KeyW', 'guarda e carrega as trocas');
check(loadBinds(fakeStore(null)).forward[0] === 'KeyW', 'sem nada guardado: padroes');
check(loadBinds(fakeStore('{lixo')).forward[0] === 'KeyW', 'JSON quebrado: padroes');
const junk = loadBinds(fakeStore(JSON.stringify({ forward: ['Escape', 7], back: 'x', ptt: ['KeyB', 'y'.repeat(40)], novaAcao: ['KeyZ'] })));
check(junk.forward.join() === ',' && junk.back[0] === 'KeyS' && junk.ptt.join() === 'KeyB,' && !('novaAcao' in junk), 'valores invalidos (Esc, tipos errados, tamanho absurdo, acao desconhecida) sao descartados');
check(loadBinds(null).map[0] === 'KeyM', 'sem armazenamento (modo privado): padroes');

// rotulos
check(keyLabel('KeyW') === 'W' && keyLabel('Space') === 'Espaço' && keyLabel('ShiftLeft') === 'Shift esq.' && keyLabel('Digit5') === '5' && keyLabel('ArrowUp') === '↑' && keyLabel('F5') === 'F5' && keyLabel('') === '—', 'rotulos legiveis das teclas');

console.log(`Resultado: ${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
