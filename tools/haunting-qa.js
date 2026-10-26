// Ferramenta opt-in: /index.html?debug&hauntqa. Nao altera o save Normal.
import { mulberry32 } from '../src/core/rng.js';
export function install(game) {
  const panel = document.createElement('section');
  panel.id = 'hauntQa';
  panel.style.cssText = 'position:fixed;z-index:99999;right:12px;top:12px;width:350px;max-height:80vh;overflow:auto;background:#121619ed;color:#e7efe9;border:1px solid #67796b;padding:14px;font:12px/1.5 monospace';
  panel.innerHTML = '<strong>APAGÃO · Ala infantil</strong><p><button id="runHauntQa">Verificar presenças</button></p><p id="roomPreviews"></p><p><button id="darkPreview">Prévia do escuro</button> <button id="lightPreview">Voltar à luz</button></p><p><button id="shadowPreview">Prévia de vulto</button> <button id="hideHauntQa">Fechar painel</button></p><pre id="hauntQaResult" style="white-space:pre-wrap">Aguardando verificação.</pre>';
  document.body.append(panel);
  const output = panel.querySelector('pre');
  const emptyInput = { mouse: { dx: 0, dy: 0, right: false }, down: () => false, hit: () => false };
  const updateCamera = () => { game.player.update(0, emptyInput); game.camera.updateMatrixWorld(true); };
  const move = (x, y, yaw = 0) => { game.player.spawn(game.grid.cx(x), game.grid.cz(y), yaw); updateCamera(); };
  const tick = dt => { game.haunting.update(dt); game.audio.library.update(dt, { zone: game.zoneAtPos(game.player.pos.x, game.player.pos.z), fear: 0, monsterDist: Infinity }); };
  const prepare = async () => {
    document.getElementById('hauntShadowProof')?.remove();
    await import('./test/pointerlock-mock.js');
    window.PLM.activeUntil = performance.now() + 120000;
    if (!game.world) await game.start(false, 'hardcore');
    game.freezeAI = true; game.ai.state = 'dormant';
    game.state = 'playing'; document.getElementById('pause').hidden = true;
    await game.audio.resume(); await game.audio.library.loaded;
    for (const id of ['children_laughter', 'toy_music', 'haunt_door_knock', 'morgue_glass', 'phantom_step']) await game.audio.library.ensure(id);
  };
  const showRoom = async index => {
    await prepare();
    game.paranoia.reset(); game.post.uniforms.paranoia.value = 0;
    game.lighting.setPowered([3], false); game.flashlight.on = true;
    const room = game.world.childWard.rooms[index], right = room.x0 > 5;
    move(right ? room.x0 : room.x1, room.y0, right ? -2.65 : 2.65);
    game.player.pitch = -0.48; updateCamera();
    if (index === 5) { move(room.x0, room.y1 - 1, -2.35); game.player.pitch = -0.63; updateCamera(); }
    game.flashlight.update(0.01, emptyInput, false);
    output.textContent = `Quarto ${index + 1}: ${room.id}\nBrinquedo: ${game.haunting.toySeen ? 'encontro já registrado' : 'primeira entrada'}`;
  };
  for (let i = 0; i < 6; i++) {
    const button = document.createElement('button'); button.textContent = 'Quarto ' + (i + 1);
    button.onclick = () => showRoom(i).catch(e => { output.textContent = 'FAIL ' + e.message; });
    panel.querySelector('#roomPreviews').append(button);
  }
  panel.querySelector('#darkPreview').onclick = async () => {
    await prepare();
    game.haunting.interrupt(); game.lighting.setPowered([], false); game.flashlight.on = false; game.flashlight.spot.intensity = 0;
    move(9, 10, -Math.PI / 2); game.paranoia.reset();
    for (let i = 0; i < 260; i++) game.paranoia.update(0.25);
    game.post.uniforms.paranoia.value = game.paranoia.strength;
    output.textContent = `Prévia: ${game.paranoia.darkSeconds.toFixed(1)}s no escuro · paranoia ${(game.paranoia.strength * 100).toFixed(0)}%`;
  };
  panel.querySelector('#lightPreview').onclick = async () => {
    await prepare(); game.flashlight.on = true;
    game.flashlight.update(0.01, emptyInput, false);
    for (let i = 0; i < 36; i++) game.paranoia.update(0.25);
    game.post.uniforms.paranoia.value = game.paranoia.strength;
    output.textContent = `Volta à luz: paranoia ${(game.paranoia.strength * 100).toFixed(0)}%`;
  };
  panel.querySelector('#hideHauntQa').onclick = () => { panel.hidden = true; };
  panel.querySelector('#shadowPreview').onclick = async () => {
    await prepare(); game.haunting.interrupt();
    game.lighting.setPowered([], false); game.flashlight.on = false; game.flashlight.spot.intensity = 0;
    const q = game.paranoia; q.reset(); q.darkSeconds = 60; q.strength = 1;
    // Posicao do mapa real verificada contra portas, cama, colisao e caminho.
    move(3, 13, Math.PI / 2);
    const originalRandom = q._random; q._random = mulberry32(2941);
    const found = q._spawnShadow(); q._random = originalRandom;
    if (!found) { output.textContent = 'FAIL Nenhuma posição de vulto alcançável nesta amostra'; return; }
    q._updateShadow(0.13); game.post.uniforms.paranoia.value = q.strength;
    // Uma imagem estática do renderer, sem mudar a duracao normal do vulto.
    game.post.render(game.scene, game.camera, game.time);
    const shot = game.renderer.domElement.toDataURL('image/png');
    const image = document.createElement('img'); image.src = shot; image.id = 'hauntShadowProof';
    image.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;z-index:99998;background:#000';
    document.getElementById('hauntShadowProof')?.remove(); document.body.append(image);
    image.onclick = () => image.remove();
    output.textContent = `Vulto no canto do olho (${q.group.position.x.toFixed(2)}, ${q.group.position.z.toFixed(2)}). Clique na imagem para voltar.`;
  };
  panel.querySelector('#runHauntQa').onclick = async () => {
    const lines = [], report = line => { lines.push(line); output.textContent = lines.join('\n'); };
    const check = (value, label) => { if (!value) throw new Error(label); report('PASS ' + label); };
    try {
      await prepare();
      const lib = game.audio.library, ward = game.world.childWard, h = game.haunting;
      check(ward.rooms.length === 6, 'seis quartos infantis no mapa real');
      check(['children_laughter', 'toy_music', 'haunt_door_knock', 'morgue_glass', 'phantom_step'].every(id => lib.has(id)), 'novos masters decodificados');
      check(lib.buffers.get('phantom_step').every(b => b.numberOfChannels === 1), 'seis passos fantasmas mono');
      h.reset(); game.paranoia.reset(); move(5, 14); tick(0.01);
      check(lib.loops.get('children_laughter')?.target > 0, 'risadas suaves no corredor');
      check(lib.loops.get('children_laughter')?.route.panner.panningModel === 'HRTF', 'risadas em 3D');
      move(5, 11); tick(0.01); check(lib.loops.get('children_laughter').target === 0, 'fade fora da ala');
      move(5, 14); tick(0.01); check(lib.loops.get('children_laughter').target > 0, 'risadas voltam na revisita');
      move(8, 14); tick(0.01); check(!h.toySeen, 'outro quarto não dispara o brinquedo');
      move(2, 14); const start = ward.toy.position.clone(); tick(0.01);
      check(h.toySeen && h.toyActive, 'primeira entrada desperta o brinquedo');
      const voice = [...lib.voices].find(v => v.id === 'toy_music');
      check(voice?.route.panner.panningModel === 'HRTF', 'melodia vem do brinquedo');
      for (let i = 0; i < 25; i++) tick(0.1);
      check(ward.toy.position.distanceTo(start) > 0.03 && voice.route.pos.z !== start.z, 'brinquedo anda e fonte sonora acompanha');
      check(game.makeSave().haunting.toySeen, 'flag incluída no save');
      for (let i = 0; i < 80; i++) tick(0.1);
      check(!h.toyActive && !ward.toyActive && ![...lib.voices].some(v => v.id === 'toy_music'), 'brinquedo desliga após dez segundos');
      const lastPlay = lib.lastPlay.get('toy_music');
      move(5, 14); tick(0.1); move(2, 14); tick(0.1);
      check(!h.toyActive && lib.lastPlay.get('toy_music') === lastPlay, 'reentrada não repete encontro');
      h.reset({ toySeen: true }); tick(0.1); check(!h.toyActive, 'continuar save conserva encontro único');
      move(20, 6); h.quietTimer = 0; h.glassTimer = 0; tick(0.1);
      check([...lib.voices].some(v => v.id === 'morgue_glass'), 'vidro cai no necrotério');
      move(5, 14); h.quietTimer = 0; h.knockTimer = 0; tick(0.1);
      check([...lib.voices].some(v => v.id === 'haunt_door_knock'), 'batidas vêm de porta próxima');
      const q = game.paranoia;
      h.interrupt(); move(9, 10, -Math.PI / 2); game.lighting.setPowered([], false);
      game.flashlight.on = false; game.flashlight.spot.intensity = 0; q.reset();
      for (let i = 0; i < 40; i++) q.update(0.25);
      check(q.strength === 0, 'escuro tem período de adaptação');
      for (let i = 0; i < 210; i++) q.update(0.25);
      check(q.strength > 0.95 && q.darkSeconds <= 60, 'paranoia cresce gradualmente e tem limite');
      const frozen = q.darkSeconds; game.state = 'paused'; q.update(1);
      check(q.darkSeconds === frozen && !q.group.visible, 'menu congela paranoia e limpa vultos');
      game.state = 'playing'; game.flashlight.on = true; game.flashlight.update(0.01, emptyInput, false);
      for (let i = 0; i < 36; i++) q.update(0.25);
      check(q.strength === 0 && !q.group.visible, 'luz alivia paranoia');
      game.post.uniforms.paranoia.value = q.strength;
      report('HAUNT_BROWSER_VERIFIED'); panel.dataset.status = 'passed';
      await showRoom(0);
      output.textContent = lines.join('\n');
    } catch (e) { report('FAIL ' + e.message); panel.dataset.status = 'failed'; console.error(e); }
  };
}
