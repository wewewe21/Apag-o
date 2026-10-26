// Opt-in visual inspection of the actual loaded boss; Hardcore preserves Normal saves.
import * as THREE from 'three';
import { CreatureModel } from '../src/entities/creature.js';
import { loadGuardianAsset } from '../src/entities/guardian-asset.js';

export function install(game) {
  const panel = document.createElement('section');
  panel.id = 'guardianQa';
  panel.style.cssText = 'position:fixed;z-index:99999;right:12px;top:12px;width:300px;max-height:82vh;overflow:auto;background:#111716ed;color:#edf3e9;border:1px solid #829280;padding:14px;font:12px/1.5 monospace';
  panel.innerHTML = '<strong>APAGÃO · Movimentos do Guardião</strong><p><button id="verifyGuardian">Verificar modelo e movimentos</button></p><div id="guardianClips"></div><p><button id="guardianMove">Andar pelo cenário</button> <button id="guardianPause">Pausar pose</button></p><label>Quadro da animação <input id="guardianPhase" type="range" min="0" max="100" value="0" step="1"></label><p><button id="guardianCompare">Comparar com anterior</button></p><p><button id="guardianHand">Ver mãos</button> <button id="guardianBody">Corpo inteiro</button></p><p><button id="guardianSide">Perfil</button> <button id="guardianFront">Frente</button></p><p><button id="guardianHide">Fechar painel</button></p><pre id="guardianResult" style="white-space:pre-wrap">Aguardando modelo.</pre>';
  document.body.append(panel);
  const output = panel.querySelector('pre');
  let spot, clock = 0, animating = false, last = 0, side = false, hand = false;
  let legacyModel = null, compareOld = false, chosen = 'idle', moving = false, playing = true, distance = 0, reportAt = 0;
  const movingClips = new Set(['walk', 'run', 'creep', 'stalk', 'limp', 'crawl']);
  const model = () => compareOld && legacyModel ? legacyModel : game.creatureModel;
  const input = { mouse: { dx: 0, dy: 0, right: false }, down: () => false, hit: () => false };
  const point = new THREE.Vector3();
  async function prepare() {
    if (!game.world) {
      await import('./test/pointerlock-mock.js');
      window.PLM.activeUntil = performance.now() + 120000;
      await game.start(false, 'hardcore');
    }
    if (!game.creatureModel.guardian) throw new Error('Guardiao não está integrado');
    game.state = 'paused'; document.getElementById('pause').hidden = true;
    game.freezeAI = true; game.ai.state = 'patrol'; game.ai.visibleModel = true;
    game.paranoia.reset(); game.post.uniforms.paranoia.value = 0;
    game.post.uniforms.fade.value = 0; game.post.uniforms.pulse.value = 0;
    if (!spot) {
      for (let y = 18; y <= 22 && !spot; y++) for (let x = 24; x <= 29 && !spot; x++) {
        const bx = game.grid.cx(x), bz = game.grid.cz(y);
        const [qx, qz] = game.grid.collideCircle(bx, bz, 0.5);
        const [px, pz] = game.grid.collideCircle(bx, bz + 4.2, 0.32);
        if (Math.hypot(qx - bx, qz - bz) < 0.01 && Math.hypot(px - bx, pz - bz - 4.2) < 0.01 && game.grid.segmentClear(px, pz, bx, bz, true)) spot = { x: bx, z: bz };
      }
      if (!spot) spot = { x: game.grid.cx(26), z: game.grid.cz(20) };
      const fill = new THREE.HemisphereLight(0xdbe6d9, 0x33352d, 0.7);
      fill.name = 'GuardianPreviewFill'; game.scene.add(fill);
    }
    const m = model();
    game.creatureModel.group.visible = !compareOld;
    if (legacyModel) legacyModel.group.visible = compareOld;
    game.ai.pos.set(spot.x, 0, spot.z); game.ai.yaw = 0;
    m.group.position.copy(game.ai.pos); m.group.rotation.y = 0; m.group.scale.setScalar(1); m.group.visible = true;
    aim(); animating = true;
  }
  function aim() {
    const m = model();
    let distance = hand ? 1.6 : 3.2, height = 1.28;
    if (hand && m.guardian) {
      m.group.updateMatrixWorld(true);
      const left = m.guardian.bones.LeftHand.getWorldPosition(new THREE.Vector3());
      const right = m.guardian.bones.RightHand.getWorldPosition(new THREE.Vector3());
      height = THREE.MathUtils.clamp((left.y + right.y) * 0.5 - m.group.position.y, 0.4, 2.4);
    }
    const angle = side ? Math.PI / 2 : 0;
    const px = spot.x + Math.sin(angle) * distance, pz = spot.z + Math.cos(angle) * distance;
    game.player.spawn(px, pz, Math.atan2(-(spot.x - px), -(spot.z - pz)));
    game.player.pitch = Math.atan2(height - 1.62, distance);
    game.player.update(0, input);
    game.camera.updateMatrixWorld(true);
    game.flashlight.on = true; game.flashlight.battery = 1;
    game.flashlight.update(0.01, input, false);
    m.lookTarget = null; m.lookWeight = 0; m.twitchTimer = 10000; m._twitchAmt = 0;
  }
  const runClip = async key => {
    try {
      await prepare();
      const m = model(); chosen = key; distance = 0; playing = true;
      panel.querySelector('#guardianPause').textContent = 'Pausar pose';
      m.guardian.resetMotion?.();
      m.mixer.stopAllAction(); m.current = null; m.painT = -1; m.shield = 0;
      m.play(key === 'shield' || key === 'pain' ? 'idle' : key, 0, { restart: true });
      if (key === 'shield') m.setShield(0.9);
      if (key === 'pain') m.flinch();
      for (let i = 0; i < 15; i++) m.update(1 / 30, 0, clock + i / 30);
      report(m);
    } catch (e) { output.textContent = 'FAIL ' + e.message; }
  };
  function report(m) {
    const info = m.data.clips[m.current];
    output.textContent = `${chosen} · ${compareOld ? 'ANIMAÇÃO ANTERIOR' : m.heavyMotion ? 'KIMODO · GUARDIÃO PESADO' : 'RETARGET ANTERIOR'}\n${info?.frames} quadros · ${m.duration(m.current).toFixed(2)}s\n${moving ? 'movendo no cenário' : 'pose no lugar'}\n${JSON.stringify({ ...m.guardian.metrics, ...m.guardian.motion?.metrics }, null, 2)}`;
  }
  for (const key of ['idle', 'walk', 'run', 'stalk', 'limp', 'crawl', 'creep', 'inspect', 'look', 'attack', 'roar', 'recoil', 'pain', 'shield']) {
    const button = document.createElement('button'); button.textContent = key;
    button.style.cssText = 'margin:2px;padding:6px'; button.onclick = () => runClip(key);
    panel.querySelector('#guardianClips').append(button);
  }
  panel.querySelector('#guardianHand').onclick = async () => { await prepare(); hand = true; aim(); };
  panel.querySelector('#guardianBody').onclick = async () => { await prepare(); hand = false; aim(); };
  panel.querySelector('#guardianSide').onclick = async () => { await prepare(); side = true; aim(); };
  panel.querySelector('#guardianFront').onclick = async () => { await prepare(); side = false; aim(); };
  panel.querySelector('#guardianMove').onclick = async event => { await prepare(); moving = !moving; distance = 0; model().guardian.resetMotion?.(); event.target.textContent = moving ? 'Manter no lugar' : 'Andar pelo cenário'; };
  panel.querySelector('#guardianPause').onclick = event => { playing = !playing; event.target.textContent = playing ? 'Pausar pose' : 'Reproduzir'; };
  panel.querySelector('#guardianPhase').oninput = async event => {
    await prepare(); playing = false; panel.querySelector('#guardianPause').textContent = 'Reproduzir';
    const m = model(), action = m.actions[m.current];
    m.guardian.resetMotion?.();
    if (action) action.time = +event.target.value / 100 * m.duration(m.current);
    m.update(0, 0, clock); report(m);
  };
  panel.querySelector('#guardianCompare').onclick = async event => {
    await prepare();
    if (!legacyModel) {
      const [old, asset] = await Promise.all([
        fetch('tools/guardian-motion-original.json').then(r => { if (!r.ok) throw new Error('Referência anterior não encontrada'); return r.json(); }),
        loadGuardianAsset('assets/Character/Guardiao.fbx'),
      ]);
      legacyModel = new CreatureModel(old, game.world.M, game.world.T, asset); game.scene.add(legacyModel.group);
    }
    compareOld = !compareOld; event.target.textContent = compareOld ? 'Mostrar novos movimentos' : 'Comparar com anterior';
    await runClip(chosen);
  };
  panel.querySelector('#guardianHide').onclick = () => { panel.hidden = true; };
  panel.querySelector('#verifyGuardian').onclick = async () => {
    const lines = [], check = (ok, label) => { if (!ok) throw new Error(label); lines.push('PASS ' + label); output.textContent = lines.join('\n'); };
    try {
      compareOld = false; moving = false; playing = true;
      await prepare(); animating = false;
      const m = game.creatureModel, meshes = [], fingers = [];
      m.guardianRoot.traverse(o => {
        if (o.isSkinnedMesh) meshes.push(o);
        if (o.isBone && /Hand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/.test(o.name)) fingers.push(o);
      });
      check(meshes.length === 1 && meshes[0].name === 'parasiteZombie', 'malha original Guardiao');
      const maps = new Set();
      for (const mesh of meshes) for (const mat of [].concat(mesh.material)) for (const slot of ['map', 'normalMap', 'specularMap']) if (mat[slot]) maps.add(mat[slot]);
      check(maps.size >= 4 && [...maps].every(t => (t.image?.naturalWidth ?? t.image?.width ?? 0) > 0), 'quatro texturas incorporadas decodificadas');
      check(fingers.length === 30, '30 articulacoes reais dos dedos');
      check(m.heavyMotion && m.data.guardianMotion?.version === 1, 'novos movimentos Kimodo e corpo pesado ativos');
      const vertex = meshes[0], indices = [200, 1200, 6000, 12000, 20000, 28000];
      for (const key of ['idle', 'walk', 'run', 'stalk', 'limp', 'crawl', 'creep', 'inspect', 'look', 'attack', 'roar', 'recoil']) {
        m.mixer.stopAllAction(); m.current = null; m.painT = -1; m.shield = 0;
        m.play(key, 0, { restart: true }); m.update(1 / 30, 0, clock);
        const before = indices.map(i => vertex.getVertexPosition(i, new THREE.Vector3()));
        const fingersBefore = fingers.map(b => b.quaternion.clone());
        for (let i = 0; i < 25; i++) m.update(1 / 30, 0, clock + i / 30);
        check(indices.some((index, i) => vertex.getVertexPosition(index, point).distanceTo(before[i]) > 0.3), key + ': pele animada');
        check(fingers.some((b, i) => b.quaternion.angleTo(fingersBefore[i]) > 0.003), key + ': dedos articulados');
        check(Number.isFinite(m.guardian.supportY()) && Math.abs(m.guardian.supportY()) < 0.18, key + ': apoio no piso');
        check(m.guardian.metrics.afterClearance >= -0.006, key + ': bracos afastados das pernas e tronco');
        m.group.updateMatrixWorld(true);
        const bounds = new THREE.Box3();
        for (let i = 0; i < vertex.geometry.attributes.position.count; i++) bounds.expandByPoint(vertex.getVertexPosition(i, point).applyMatrix4(vertex.matrixWorld));
        bounds.expandByScalar(0.03);
        check(bounds.containsPoint(m.headWorld(new THREE.Vector3())) && bounds.containsPoint(m.chestWorld(new THREE.Vector3())), key + ': rosto e peito seguem a pele real');
      }
      m.play('idle', 0); m.setShield(0.9); m.update(1 / 30, 0, clock);
      check(m.actions.shield.isRunning(), 'defesa da lanterna preservada');
      m.setShield(0); check(m.flinch(), 'dor aditiva preservada');
      for (let i = 0; i < 25; i++) m.update(1 / 30, 0, clock + i / 30);
      check(m.painT < 0, 'dor termina e nao acumula');
      const markerDistance = m.headWorld(point).distanceTo(m.chestWorld(new THREE.Vector3()));
      check(markerDistance > 0.15 && markerDistance < 0.9, 'pontos do rosto e peito coerentes na postura curvada');
      lines.push('GUARDIAN_HEAVY_BROWSER_VERIFIED'); output.textContent = lines.join('\n');
      animating = true; m.play('idle', 0);
    } catch (e) { lines.push('FAIL ' + e.message); output.textContent = lines.join('\n'); animating = false; }
  };
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!animating || !playing || !game.creatureModel?.guardian) return;
    const m = model();
    if (moving && movingClips.has(m.current)) {
      distance += m.clipSpeed(m.current) * dt;
      if (distance > 3) { distance = 0; m.guardian.resetMotion?.(); }
      m.group.position.set(spot.x, 0, spot.z + distance);
      // Follow the model while the floor visibly moves beneath the planted feet.
      const startZ = spot.z; spot.z = startZ + distance; aim(); spot.z = startZ;
    }
    clock += dt; m.update(dt, 0, clock);
    panel.querySelector('#guardianPhase').value = (m.actions[m.current]?.time ?? 0) / m.duration(m.current) * 100;
    if (now > reportAt && moving) { reportAt = now + 300; report(m); }
  }
  requestAnimationFrame(frame);
}
