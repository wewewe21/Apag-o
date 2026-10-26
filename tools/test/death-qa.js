// Ajuda para ver a CENA DE MORTE no navegador (pagina com ?debug). Console:
//   const qa = await import('/tools/test/death-qa.js?v=1'); await qa.setup();
//   qa.pose({ fold: 1, neck: .3, reach: 1, d: 1.1 }); qa.fp();    // pose parada, vista do jogador
//   qa.side(); qa.render();                                         // pose parada, camera lateral (bracos/maos e marcadores)
//   qa.play(1.2);                                                   // dispara a cena de verdade (dbg.kill) e avanca ate t = 1.2 s
//   qa.advance(0.5);                                                // continua a mesma cena por mais 0.5 s (renderiza um quadro)
import { boot, THREE } from '/tools/test/browser-helpers.js?v=1';

export async function setup() {
  const g = await boot({ start: 'normal' });
  window.PLM.activeUntil = performance.now() + 3600000;
  g.pause = () => {};                          // painel sem foco nao pausa durante a medicao
  g.freezeAI = true; g.wakeCreature();
  const grid = g.grid, P = g.player;
  let dir = 0;
  for (let a = 0; a < 16; a++) { const ang = a * Math.PI / 8, x = P.pos.x + Math.sin(ang) * 2.2, z = P.pos.z + Math.cos(ang) * 2.2; if (grid.segmentClear(P.pos.x, P.pos.z, x, z, true)) { dir = ang; break; } }
  const qa = window.qa = { g, dir, THREE };
  qa.light = new THREE.PointLight(0xcfe8d8, 0, 10, 2); g.scene.add(qa.light);
  qa.marks = [0xff0000, 0x00ff00, 0x0000ff].map(c => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: c })); s.visible = false; g.scene.add(s); return s; });
  g._frame = () => {};                         // sem laco em tempo real: quem avanca o jogo somos nos (cenas reproduziveis)
  return qa;
}

export function pose(o = {}) {
  const { g, dir } = window.qa, P = g.player, ai = g.ai, m = ai.m, grid = g.grid;
  const d = o.d ?? 1.0;
  ai.state = 'attack'; m.group.visible = true; ai.visibleModel = true; g.freezeAI = true;
  ai.pos.set(P.pos.x + Math.sin(dir) * d, grid.floorY(P.pos.x, P.pos.z), P.pos.z + Math.cos(dir) * d); ai.yaw = dir + Math.PI;
  P.yaw = Math.atan2(-Math.sin(dir), -Math.cos(dir));
  const dp = m.deathPose; dp.on = true; dp.fold = o.fold ?? 0; dp.neck = o.neck ?? 0; dp.reach = o.reach ?? 0; dp.shake = o.shake ?? 0; dp.sink = o.sink ?? 0;
  const cam = new THREE.Vector3(P.pos.x, P.pos.y + P.eyeY + (o.lift ?? 0), P.pos.z);
  const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), right = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  dp.hands[0].copy(cam).addScaledVector(right, 0.24).addScaledVector(fwd, 0.08).add(new THREE.Vector3(0, -0.32, 0));
  dp.hands[1].copy(cam).addScaledVector(right, -0.24).addScaledVector(fwd, 0.08).add(new THREE.Vector3(0, -0.32, 0));
  dp.grab.copy(cam).add(new THREE.Vector3(0, -0.2, 0)).addScaledVector(fwd, 0.05);
  m.lookTarget = cam; m.lookWeight = 1;
  m.play('idle', 0); window.qa.cam = cam;
  step(8);
}

// avanca o modelo alguns quadros (sem precisar do requestAnimationFrame do painel)
export function step(n = 4) {
  const { g } = window.qa, ai = g.ai;
  for (let i = 0; i < n; i++) { g.time += 1 / 30; ai.m.group.position.copy(ai.pos); ai.m.group.rotation.y = ai.yaw; ai.m.update(1 / 30, ai.pos.y, g.time); }
}

export function head() { return window.qa.g.ai.m.headWorld(new THREE.Vector3()); }

export function fp(o = {}) {
  const { g } = window.qa, hv = head(), c = window.qa.cam.clone();
  g.camera.position.copy(c); g.camera.lookAt(hv.x, hv.y + (o.dy ?? 0), hv.z); g.camera.updateMatrixWorld(true);
  window.qa.light.position.set(c.x, c.y + 0.5, c.z); window.qa.light.intensity = o.light ?? 3;
  for (const k of window.qa.marks) k.visible = false;
  render();
  return { head: hv.toArray().map(v => +v.toFixed(2)), dist: +hv.distanceTo(c).toFixed(2) };
}

export function side(o = {}) {
  const { g, dir } = window.qa, c = window.qa.cam, dp = g.ai.m.deathPose;
  const sx = Math.cos(dir), sz = -Math.sin(dir);
  const mid = c.clone().add(new THREE.Vector3(Math.sin(dir) * (o.mid ?? 0.5), -0.2, Math.cos(dir) * (o.mid ?? 0.5)));
  const s = o.side ?? 3.4;
  g.camera.position.set(mid.x + sx * s, o.h ?? 1.7, mid.z + sz * s); g.camera.lookAt(mid.x, o.look ?? 1.7, mid.z); g.camera.updateMatrixWorld(true);
  window.qa.light.position.set(g.camera.position.x - sx * 0.5, 2.5, g.camera.position.z - sz * 0.5); window.qa.light.intensity = 40;
  window.qa.marks[0].position.copy(c); window.qa.marks[1].position.copy(dp.hands[0]); window.qa.marks[2].position.copy(dp.hands[1]);
  for (const k of window.qa.marks) k.visible = true;
  render();
}

export function render() { const { g } = window.qa; g.post.render(g.scene, g.camera, g.time); }

// dispara a cena de morte de verdade e avanca ate t segundos; renderiza um quadro
export function play(t = 0, o = {}) {
  const { g } = window.qa;
  window.dbg.kill(o.d ?? 1.0, o.ang ?? null);
  return advance(t);
}

export function advance(dt = 0.1) {
  const { g } = window.qa, sc = g.deathScene;
  if (dt > 0) window.dbg.sim(dt);
  render();
  return { state: g.state, t: +sc.t.toFixed(2), fov: +g.camera.fov.toFixed(1), head: head().toArray().map(v => +v.toFixed(2)), cam: g.camera.position.toArray().map(v => +v.toFixed(2)) };
}
