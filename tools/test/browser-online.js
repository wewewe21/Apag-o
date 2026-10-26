// Ajudantes de navegador para o modo Online (console): cria a sala pela interface, espera o robo (tools/test/playbot.mjs) e inicia.
// Uso: const o = await import('/tools/test/browser-online.js?v=1'); await o.startWithBot('Willian');
export const wait = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

export async function startWithBot(name = 'Willian', { bots = 1, timeout = 30000, freeze = true } = {}) {
  await import('/tools/test/pointerlock-mock.js?v=2'); window.PLM.activeUntil = performance.now() + 3600_000;
  $('btnOnline').click();
  const t0 = performance.now();
  while ($('onCreate').disabled && performance.now() - t0 < timeout) await wait(200);
  $('onName').value = name; $('onCreate').click();
  while ($('lobby').hidden && performance.now() - t0 < timeout) await wait(200);
  // espera os robos ficarem prontos e o mapa carregar
  while (performance.now() - t0 < timeout) {
    const ready = [...document.querySelectorAll('#lbMembers li')].filter(l => /pronto/.test(l.textContent)).length;
    if (ready >= bots && /Mapa pronto/.test($('lbStatus').textContent)) break;
    await wait(300);
  }
  $('lbStart').click();
  const o = window.__online;
  while (!o.inMatch && performance.now() - t0 < timeout + 15000) await wait(200);
  await wait(500);
  if (freeze) o.net.send({ t: 'dbg', cmd: 'freeze', on: 1 });     // criatura parada (teste da interface)
  return o;
}

// leva o servidor a teleportar este jogador (so com APAGAO_TEST=1 no servidor)
export async function tp(x, z) { window.__online.net.send({ t: 'dbg', cmd: 'tp', x, z }); await wait(350); }

// ponto livre e alcancavel a pe perto de (x,z), com linha de visao para o alvo (moveis nao bloqueiam)
export function nearSpot(x, z, r0 = 0.7, r1 = 1.6) {
  const g = window.__game.grid;
  for (let r = r0; r <= r1; r += 0.2) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const [qx, qz] = g.collideCircle(px, pz, 0.32);
    if (Math.hypot(qx - px, qz - pz) > 0.01 || !g.isFloor(g.cellX(px), g.cellY(pz))) continue;
    if (!g.segmentClear(px, pz, x, z, true, (b) => b.prop || b.kind === 'drawers')) continue;
    return [px, pz];
  }
  return null;
}

// pega o item `key` do mundo pela interface (teleporte de servidor + olhar + E). Devolve true se ficou carregando.
export async function grab(key) {
  const o = window.__online, g = window.__game, C = 1.25;
  const s = o.itemState.get(key);
  if (key === 'fuse:4') { await openDrawer(13); }
  const sp = nearSpot(s.x, s.z) || [s.x + 0.8, s.z];
  await tp(sp[0], sp[1]);
  dbg.look(s.x / C, s.z / C, s.y);
  dbg.use(); await wait(450);
  return o.itemState.get(key).st === 'carried' && o.itemState.get(key).by === o.me;
}

export async function openDrawer(num) {
  const o = window.__online, g = window.__game, w = g.world, C = 1.25;
  const d = w.drawers.find(x => x.num === num);
  if (d.target > 0.5) return;
  const p = [d.x, w.drawerBank.zf + 1.3];
  await tp(p[0], p[1]);
  dbg.look(d.x / C, (w.drawerBank.zf + 0.02) / C, d.y);
  dbg.use(); await wait(500);
  for (let i = 0; i < 40; i++) w.update(0.05);
}

export async function installAll() {
  const o = window.__online, g = window.__game, C = 1.25;
  const pn = g.objectives.pos;
  const sp = nearSpot(pn.x, pn.z, 0.8, 1.6) || [pn.x, pn.z - 1.2];
  await tp(sp[0], sp[1]);
  dbg.look(pn.x / C, pn.z / C, 1.2);
  const before = g.objectives.installed.length;
  dbg.use(); await wait(4200);
  return { before, after: g.objectives.installed.length };
}
