// Cena de morte (cliente): o roteiro por tempo (funcao pura) e a classe com um jogo falso, sem navegador.
// Uso: node tools/test/death-scene-test.mjs
import * as THREE from 'three';
import { DEATH, DeathScene, sampleDeath } from '../../src/entities/deathscene.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FALHA ') + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const N = Math.round(DEATH.endT * 60);

console.log('\n# Roteiro (sampleDeath): valores nos instantes-chave e continuidade');
{
  const s0 = sampleDeath(0), I = sampleDeath(DEATH.impactT), end = sampleDeath(DEATH.endT);
  ok(near(s0.fold, 0) && s0.fade === 0 && s0.flash === 0 && s0.timeScale === 1 && s0.reach === 0, 'em t = 0 tudo parado: sem dobra, sem fade, sem clarao, tempo normal');
  ok(near(I.reach, 1) && sampleDeath(DEATH.impactT - 0.05).reach < 1, 'as maos fecham nos ombros EXATAMENTE no agarrao (0,75 s, junto com o 2o estouro de som)');
  ok(sampleDeath(0.7).fold > 0.95, 'o mergulho ja terminou antes do agarrao (tronco dobrado)');
  ok(end.fade === 1, 'ao fim da cena a tela esta toda preta');
  let minTs = 1, tsOutside = 0, maxFlashBeforeBite = 0, fadeMono = true, prevFade = 0, minFold = 9, maxFold = -9, maxFov = 0, minFov = 999, inRange = true;
  for (let i = 0; i <= N; i++) {
    const t = i / 60, s = sampleDeath(t);
    minTs = Math.min(minTs, s.timeScale);
    if ((t < DEATH.impactT - 0.01 || t > DEATH.impactT + 0.12) && s.timeScale !== 1) tsOutside++;
    if (t < 2.25) maxFlashBeforeBite = Math.max(maxFlashBeforeBite, s.flash);
    if (s.fade < prevFade - 1e-9) fadeMono = false; prevFade = s.fade;
    minFold = Math.min(minFold, s.fold); maxFold = Math.max(maxFold, s.fold); maxFov = Math.max(maxFov, s.fov); minFov = Math.min(minFov, s.fov);
    for (const k of ['fold', 'neck', 'reach', 'shake', 'trauma', 'flash', 'shock', 'tunnel', 'pulse', 'fade', 'light', 'timeScale', 'bite', 'dist']) if (!Number.isFinite(s[k]) || (k !== 'fold' && s[k] < -1e-9) || s[k] > 3) inRange = false;
  }
  ok(inRange, 'todos os valores do roteiro sao finitos e ficam em faixas sensatas');
  ok(near(minTs, 0.1, 0.02) && tsOutside === 0, `a congelada de tempo so existe em volta do agarrao (minimo ${minTs.toFixed(2)}; fora da janela: ${tsOutside} quadros)`);
  ok(maxFlashBeforeBite <= 0.62, `o clarao da pancada nao apaga a imagem (pico ${maxFlashBeforeBite.toFixed(2)})`);
  ok(fadeMono, 'o fade para o preto nunca volta atras');
  ok(minFold > -0.2 && maxFold < 1.15, `a dobra do tronco fica entre ${minFold.toFixed(2)} e ${maxFold.toFixed(2)} (sem contorcao absurda)`);
  ok(minFov > 45 && maxFov < 95, `o FOV varia entre ${minFov.toFixed(0)} e ${maxFov.toFixed(0)} graus`);
  // continuidade: sem saltos de quadro a quadro nas curvas de corpo e de camera (so as pancadas podem ser bruscas)
  let worst = 0, worstK = '';
  for (let i = 1; i <= N; i++) {
    const a = sampleDeath((i - 1) / 60), b = sampleDeath(i / 60);
    for (const [k, lim] of [['fold', 0.09], ['neck', 0.08], ['reach', 0.08], ['along', 0.2], ['liftK', 0.05], ['faceTarget', 0.03]]) { const d = Math.abs(b[k] - a[k]) / lim; if (d > worst) { worst = d; worstK = k; } }
  }
  ok(worst <= 1, `corpo e camera mudam suavemente quadro a quadro (o bote e o puxao do agarrao sao deliberadamente rapidos: ate 0,09 de dobra e 0,2 m por quadro) (pior: ${worstK} a ${(worst * 100).toFixed(0)}% do limite)`);
  ok(JSON.stringify(sampleDeath(1.234)) === JSON.stringify(sampleDeath(1.234)), 'deterministico: o mesmo instante da sempre a mesma cena');
}

console.log('\n# DeathScene com jogo falso: ciclo completo (comecar, rodar, terminar, voltar ao normal)');
{
  const cam = new THREE.PerspectiveCamera(72, 1.2, 0.05, 70);
  const scene = new THREE.Scene(); scene.add(cam);
  const calls = { play: [], poseReset: 0 };
  const head = new THREE.Vector3();
  const creature = {
    pos: new THREE.Vector3(2, 0, 0), yaw: 0, moveSpeed: 3,
    m: {
      group: { position: new THREE.Vector3(), rotation: { y: 0 } }, lookTarget: null, lookWeight: 0, eyeshine: 0,
      deathPose: { on: false, fold: 0, neck: 0, reach: 0, shake: 0, sink: 0, hands: [new THREE.Vector3(), new THREE.Vector3()], grab: new THREE.Vector3(), reset() { this.on = false; this.fold = this.neck = this.reach = this.shake = 0; calls.poseReset++; } },
      play(...a) { calls.play.push(a[0]); },
      update() { calls.update = (calls.update || 0) + 1; },
      headWorld(out) { return out.copy(head); },
    },
  };
  const style = {};
  const game = {
    player: { pos: new THREE.Vector3(0, 0, 0), eyeY: 1.62, yaw: Math.PI / 2, pitch: 0 },
    camera: cam, scene, grid: { segmentClear: () => true },
    hud: { el: { hud: { style } } },
    flashlight: { spot: { intensity: 5 }, fill: { intensity: 1 }, holder: new THREE.Object3D() },
    post: { uniforms: { pulse: { value: 0 }, shock: { value: 0 }, flash: { value: 0 }, tunnel: { value: 0 }, fade: { value: 0 }, flashColor: { value: new THREE.Color() }, fadeColor: { value: new THREE.Color() } } },
  };
  const ds = game.deathScene = new DeathScene(game);
  ok(!ds.running && !ds.driving && !ds.done && ds.timeScale === 1, 'antes de comecar a cena nao interfere em nada');
  ds.start(creature, { fromHide: false });
  ok(ds.running && ds.driving && !ds.done && creature.m.deathPose.on && style.opacity === '0' && calls.play[0] === 'roar', 'ao comecar: cena rodando, pose ligada, HUD apagado e a criatura ruge (clipe "roar")');
  ds.start(creature, {});          // segundo aviso (mensagem de rede repetida)
  ok(calls.play.length === 1 && ds.t < 0.01, 'um segundo aviso de captura nao reinicia a cena');
  const dist0 = Math.hypot(creature.pos.x, creature.pos.z);
  const qPrev = new THREE.Quaternion(), qNow = new THREE.Quaternion(); let maxWBite = 0;
  let bad = 0, fovMin = 99, fovMax = 0, maxDt = 0, doneAt = null, minD = 9, maxD = 0, handsOk = true, yawOk = true;
  for (let i = 0; i < 60 * 4 && doneAt == null; i++) {
    // a cabeca (falsa) vai ficando COLADA na camera no bote final: foi ai que a mira antiga enlouquecia
    const ux = creature.pos.x - game.player.pos.x, uz = creature.pos.z - game.player.pos.z, ul = Math.hypot(ux, uz) || 1, bd = 0.55 - 0.2 * ds.s.bite;                      // a cabeca fica a >= 0,35 m dos olhos; e a CAMERA que e puxada para dentro dela
    head.set(game.player.pos.x + ux / ul * bd, 1.8 + 0.28 * Math.sin(i * 0.9) * ds.s.bite, game.player.pos.z + uz / ul * bd);
    const before = ds.t; ds.update(1 / 60); applyFxLike();
    qPrev.copy(qNow); cam.updateMatrixWorld(true); qNow.copy(cam.quaternion);
    if (i > 0 && ds.t > 2.0) maxWBite = Math.max(maxWBite, 2 * Math.acos(Math.min(1, Math.abs(qNow.dot(qPrev)))) * 60 * 57.2958);
    if (!cam.position.toArray().every(Number.isFinite) || !cam.rotation.toArray().slice(0, 3).every(Number.isFinite)) bad++;
    fovMin = Math.min(fovMin, cam.fov); fovMax = Math.max(fovMax, cam.fov);
    const d = Math.hypot(creature.pos.x - game.player.pos.x, creature.pos.z - game.player.pos.z); minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    const dp = creature.m.deathPose;
    for (const h of dp.hands) if (!Number.isFinite(h.x + h.y + h.z)) handsOk = false;
    // a criatura sempre de frente para o jogador
    const want = Math.atan2(-(creature.pos.x - game.player.pos.x) / d, -(creature.pos.z - game.player.pos.z) / d);
    if (Math.abs(Math.atan2(Math.sin(creature.yaw - want), Math.cos(creature.yaw - want))) > 1e-6) yawOk = false;
    if (ds.done) doneAt = ds.t;
  }
  function applyFxLike() { ds.applyFx(game.post.uniforms); }
  ok(bad === 0 && handsOk, 'camera e maos sempre com numeros validos durante toda a cena');
  ok(doneAt != null && near(doneAt, DEATH.endT, 0.02), `a cena termina em ${DEATH.endT} s (terminou em ${doneAt?.toFixed(2)})`);
  ok(yawOk, 'a criatura fica sempre de frente para o jogador');
  ok(maxWBite < 300, `no bote final a camera nao gira feito louca, mesmo com a cabeca colada nela (pico ${maxWBite.toFixed(0)} graus/s; antes passava de 2000)`);
  ok(minD >= 0.49 && maxD <= 1.95, `o pivo da criatura fica entre ${minD.toFixed(2)} e ${maxD.toFixed(2)} m do jogador (nunca dentro dele, nunca longe)`);
  ok(fovMin > 45 && fovMax < 95, `FOV da camera entre ${fovMin.toFixed(0)} e ${fovMax.toFixed(0)}`);
  ok(game.post.uniforms.fade.value === 1 && game.flashlight.spot.intensity <= 5, 'no fim a tela esta preta');
  const t = ds.t; ds.update(1 / 60);
  ok(ds.t === t, 'depois de terminar a cena congela (nao avanca mais)');
  ds.reset();
  const u = game.post.uniforms;
  ok(!ds.running && !ds.driving && ds.timeScale === 1 && cam.fov === 72 && style.opacity === '' && u.fade.value === 0 && u.shock.value === 0 && u.flash.value === 0 && u.tunnel.value === 0 && u.pulse.value === 0 && !creature.m.deathPose.on && game.flashlight.holder.rotation.x === 0, 'reset: tudo volta ao normal (FOV, HUD, efeitos de tela, pose, lanterna)');
  ok(scene.children.length === 1, 'reset: a luz da cena sai do mundo (so a camera fica na cena)');
  ds.start(creature, {});
  ok(ds.running && ds.t < 0.01, 'a cena pode rodar de novo depois do reset (segunda morte)');
  ds.reset();
}

console.log('\n# Mira da cabeca (olhar fixo permanente): sem pulo de ombro quando o jogador fica atras do corpo');
{
  let CreatureModel = null;
  try { ({ CreatureModel } = await import('../../src/entities/creature.js')); } catch (e) { console.log('  (creature.js nao carrega no Node: ' + String(e.message).slice(0, 80) + ')'); }
  if (CreatureModel) {
    const aim = (m, x, z, y = 0) => CreatureModel.prototype._aimDirection.call(m, new THREE.Vector3(x, y, z).normalize());
    const yawOf = (v, by) => { const c = Math.cos(by), sn = Math.sin(by); return Math.atan2(v.x * c - v.z * sn, v.x * sn + v.z * c); };
    const fresh = () => ({ group: { rotation: { y: 0 } }, _dt: 1 / 60 });
    // 1) alvo ao alcance (a 40 graus do corpo): a cabeca vai exatamente para ele
    let m = fresh(), d = null;
    for (let i = 0; i < 30; i++) d = aim(m, Math.sin(0.7), Math.cos(0.7));
    ok(Math.abs(yawOf(d, 0) - 0.7) < 1e-6, 'alvo ao alcance: a cabeca mira exatamente nele');
    // 2) giro limitado em velocidade: nunca teleporta
    m = fresh(); let prev = 0, maxStep = 0;
    for (let i = 0; i < 40; i++) { d = aim(m, Math.sin(1.6), Math.cos(1.6)); const y = yawOf(d, 0); maxStep = Math.max(maxStep, Math.abs(y - prev)); prev = y; }
    ok(maxStep <= 8 / 60 + 1e-6, `a cabeca gira no maximo ${(maxStep * 60 * 57.3).toFixed(0)} graus/s (limite ${(8 * 57.3).toFixed(0)})`);
    // 3) jogador logo atras do corpo, oscilando 0,2 rad para cada lado: o ombro nao troca a cada quadro
    m = fresh(); for (let i = 0; i < 40; i++) aim(m, Math.sin(2.9), Math.cos(2.9));
    let flips = 0, last = Math.sign(yawOf(aim(m, Math.sin(2.9), Math.cos(2.9)), 0));
    for (let i = 0; i < 200; i++) { const a = Math.PI + Math.sin(i * 0.4) * 0.2; const y = Math.sign(yawOf(aim(m, Math.sin(a), Math.cos(a)), 0)); if (y !== last) flips++; last = y; }
    ok(flips === 0, `jogador oscilando logo atras do corpo: a cabeca nao troca de ombro (${flips} trocas)`);
    // 4) o jogador passa de verdade para o outro lado: o giro nunca passa da velocidade maxima (sem teleporte)
    m = fresh(); for (let i = 0; i < 40; i++) aim(m, Math.sin(2.4), Math.cos(2.4));
    let mx = 0, py = yawOf(aim(m, Math.sin(2.4), Math.cos(2.4)), 0);
    for (let a = 2.4; a <= 3.9; a += 0.01) { const y = yawOf(aim(m, Math.sin(a), Math.cos(a)), 0); mx = Math.max(mx, Math.abs(y - py)); py = y; }
    ok(mx <= 8 / 60 + 1e-6, `ao trocar de ombro o giro nunca passa da velocidade maxima (${(mx * 60 * 57.3).toFixed(0)} graus/s)`);
    // 5) para cima tambem e limitado (o pescoco nao dobra alem de ~50 graus)
    m = fresh(); for (let i = 0; i < 60; i++) d = aim(m, 0.01, 1, 3);
    ok(Math.asin(d.y) <= 0.9 + 1e-6, `olhar para cima e limitado (${(Math.asin(d.y) * 57.3).toFixed(0)} graus)`);
  }
}

console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
