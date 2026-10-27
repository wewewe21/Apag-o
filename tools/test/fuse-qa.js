// QA no navegador (precisa dos modelos 3D carregados, por isso nao roda no `npm test`):
//   abra http://localhost:8765/index.html?debug&autostart e, no console:
//   const q = await import('/tools/test/fuse-qa.js?v=1'); q.settleAudit()
// Para CADA ponto possivel de fusivel, pousa um fusivel de teste na superficie real (raios para baixo) e mostra o quanto ele subiu/desceu
// em relacao ao numero do mapa. Esperado: tampos de mesa/bancada ~0; cama -0,15 (o lencol e mais baixo que o numero do mapa: sem isso o
// fusivel flutuava 15 cm); nenhum ponto sem superficie (failed vazio); desvio lateral (dxz) so quando ha coisa em cima do movel.
import { collectFuseSpots } from '/src/shared/fusespots.js';

export function settleAudit(game = window.dbg.game) {
  const w = game.world, V = game.camera.position.constructor;
  const rows = [];
  for (const s of collectFuseSpots(w)) {
    const it = w.spawnItem('fuse', 99, new V(s.x, s.y, s.z));
    it.mesh.rotation.set(0, 1.0, 0);
    const ok = w.settleItem(it);
    rows.push({ id: s.id, kind: s.kind, room: s.room, dy: ok ? +(it.mesh.position.y - s.y).toFixed(3) : null, dxz: ok ? +Math.hypot(it.mesh.position.x - s.x, it.mesh.position.z - s.z).toFixed(2) : null });
    it.mesh.parent.remove(it.mesh); w.items.splice(w.items.indexOf(it), 1);
    const ix = w.interactables.findIndex(x => x.item === it); if (ix >= 0) w.interactables.splice(ix, 1);
  }
  return {
    n: rows.length,
    failed: rows.filter(r => r.dy === null).map(r => r.id),
    bigDy: rows.filter(r => r.dy !== null && Math.abs(r.dy) > 0.05 && r.kind !== 'bed').map(r => `${r.id} dy=${r.dy}`),
    movedSideways: rows.filter(r => r.dxz > 0).map(r => `${r.id} dxz=${r.dxz}`),
    rows,
  };
}
