// Ajudantes para testar o jogo no painel do navegador (console): const h = await import('/tools/test/browser-helpers.js?v=1'); await h.boot();
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
export { THREE };

// recarrega os modulos ignorando o cache do painel embutido
export async function refresh() {
  const names = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.startsWith(location.origin) && /\.(js|html|json|css)(\?|$)/.test(n));
  await Promise.all([...names, location.origin + '/index.html'].map(n => fetch(n, { cache: 'reload' })));
  location.reload();
}

// inicia o jogo com pointer lock simulado (o painel embutido recusa o real) e devolve utilitarios
export async function boot({ mock = true, start = 'normal' } = {}) {
  if (mock) { await import('/tools/test/pointerlock-mock.js?v=2'); window.PLM.activeUntil = performance.now() + 30000; }
  const g = window.__game;
  if (g.state === 'title') { await g.start(false, start); await new Promise(r => setTimeout(r, 600)); }
  if (g.state === 'paused') { document.getElementById('pause').hidden = true; g.state = 'playing'; }
  window.T3 = THREE;
  return g;
}

export function lockerSpot(g, cx, cy) { return g.world.hideSpots.find(s => s.type === 'locker' && s.cell[0] === cx && s.cell[1] === cy); }
