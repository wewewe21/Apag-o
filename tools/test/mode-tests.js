// Testes de navegador dos modos solo (console): const t = await import('/tools/test/mode-tests.js?v=1'); await t.normal(); / await t.hardcore();
// Rode cada um numa pagina recarregada (?debug). Devolvem um objeto com os resultados e `ok`.
import { boot, THREE } from '/tools/test/browser-helpers.js?v=1';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function take(g, type, id) {
  const w = g.world;
  const it = w.items.find(i => i.type === type && (id === undefined || i.id === id));
  dbg.standNear(it.mesh.getWorldPosition(new THREE.Vector3()), 1.0);
  const t = g.findInteractable(); t.use(g);
  if (g.state === 'reading') g.closeNote();
  return it.taken;
}

export async function normal() {
  localStorage.removeItem('apagao.save.v1');
  const g = await boot({ start: 'normal' });
  const w = g.world; g.freezeAI = true;
  const out = {};
  out.pick1 = take(g, 'fuse', 1);
  dbg.standNear(g.objectives.pos.clone(), 1.0); dbg.use(); await wait(1200);
  out.installedAfter1 = [...g.objectives.installed];
  out.saveInstalled = JSON.parse(localStorage.getItem('apagao.save.v1')).installed;
  out.pick2 = take(g, 'fuse', 2);                       // coletado, mas NAO instalado
  g.checkpoint('teste');
  out.saveWithCarry = JSON.parse(localStorage.getItem('apagao.save.v1')).installed;
  g.state = 'dead'; g.playerDies(); g.respawn(); await wait(200);
  out.after = { installed: [...g.objectives.installed], carried: [...g.player.inventory.fuses], fuse2Home: !w.items.find(i => i.type === 'fuse' && i.id === 2).taken, socket1: g.objectives.sockets[0].fuse.visible };
  out.ok = out.pick1 && out.installedAfter1.join() === '1' && out.saveInstalled.join() === '1' && out.saveWithCarry.join() === '1'
    && out.after.installed.join() === '1' && out.after.carried.length === 0 && out.after.fuse2Home && out.after.socket1;
  return out;
}

export async function hardcore() {
  const saveBefore = localStorage.getItem('apagao.save.v1'), keysBefore = Object.keys(localStorage).sort().join(',');
  const g = await boot({ start: 'hardcore' });
  const w = g.world; g.freezeAI = true;
  const pristine = dbg.digest();
  const out = { hadNormalSave: !!saveBefore, saveIntactAfterStart: localStorage.getItem('apagao.save.v1') === saveBefore };
  take(g, 'key'); take(g, 'fuse', 1); take(g, 'fuse', 2); take(g, 'fuse', 3); take(g, 'battery');
  dbg.standNear(g.objectives.pos.clone(), 1.0); dbg.use(); await wait(2200);
  out.installed = [...g.objectives.installed];
  const dk = w.doorsList.find(d => d.kind === 'K'); dbg.standNear(new THREE.Vector3(dk.cx, dk.base + 1.1, dk.cz), 1.1); dbg.use(); dk.setOpen(true, g.player.pos.x, g.player.pos.z); dbg.sim(1);
  const d13 = w.drawers.find(d => d.num === 13); w.drawerMesh(d13); d13.target = 1; for (let i = 0; i < 60; i++) w.update(0.05);
  w.doorsList.filter(d => d.kind === 'D').slice(0, 4).forEach(d => d.setOpen(true, 0, 0)); dbg.sim(2);
  w.hideSpots[0].target = 1; dbg.sim(1);
  g.burstLamp(g.lighting.lamps.find(l => l.type === 'fluor' && l.state === 'ok'));
  g.freezeAI = false; g.wakeCreature(); g.ai.habit = 2; dbg.sim(3); g.freezeAI = true;
  g.stats.repels = 3; g.objectives.startCharge(); dbg.sim(2);
  out.dirtyDiffers = dbg.digest() !== pristine;
  out.saveIntactAfterPlay = localStorage.getItem('apagao.save.v1') === saveBefore;
  g.state = 'dead'; g.playerDies(); g.respawn(); await wait(300);
  if (g.state === 'paused') { document.getElementById('pause').hidden = true; g.state = 'playing'; }
  dbg.sim(0.2);
  const after = dbg.digest();
  out.restartMatchesPristine = after === pristine;
  if (!out.restartMatchesPristine) { const A = JSON.parse(pristine), B = JSON.parse(after); out.diff = Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])); }
  out.saveIntactAfterRestart = localStorage.getItem('apagao.save.v1') === saveBefore;
  out.noNewStorageKeys = Object.keys(localStorage).sort().join(',') === keysBefore;
  out.mode = g.mode; out.deaths = g.stats.deaths;
  out.ok = out.dirtyDiffers && out.restartMatchesPristine && out.saveIntactAfterStart && out.saveIntactAfterPlay && out.saveIntactAfterRestart && out.noNewStorageKeys && out.mode === 'hardcore';
  return out;
}
