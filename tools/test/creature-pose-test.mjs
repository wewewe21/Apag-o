// Pose do Noturno no esqueleto REAL (FBX monstrorigado): parado ele tem os bracos longos, retos e caidos ao lado do corpo (entidade),
// nao cotovelo dobrado com a mao mole para frente (zumbi). Mede os ossos de verdade, sem navegador.
// Uso: node tools/test/creature-pose-test.mjs
import * as THREE from 'three';
import fs from 'node:fs';
import { CreatureModel } from '../../src/entities/creature.js';
import { parseSkinwalkerForInspection } from '../skinwalker-asset-inspect.mjs';
import { begin } from './skinwalker-fixture.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FALHA ') + m); };
const data = JSON.parse(fs.readFileSync(new URL('../../assets/anim/creature.json', import.meta.url), 'utf8'));
const { asset } = await parseSkinwalkerForInspection();
const model = new CreatureModel(structuredClone(data), null, null, asset);
const B = model.guardian.bones, v = [0, 1, 2, 3].map(() => new THREE.Vector3());

// angulo do cotovelo (0 = braco reto) e altura da mao em relacao ao ombro, media de uma volta do clipe
function arm(clip, side, seconds = 2.4) {
  begin(model, clip);
  let elbow = 0, hand = 0, drop = 0, n = 0;
  for (let f = 0; f < Math.round(seconds * 30); f++) {
    model.update(1 / 30, 0, f / 30);
    if (f < 12) continue;
    model.rig.updateMatrixWorld(true);
    const S = B[side + 'Arm'].getWorldPosition(v[0]), E = B[side + 'ForeArm'].getWorldPosition(v[1]), H = B[side + 'Hand'].getWorldPosition(v[2]);
    const a = E.clone().sub(S).normalize(), b = H.clone().sub(E).normalize();
    elbow += Math.acos(Math.min(1, Math.max(-1, a.dot(b)))); drop += (S.y - H.y) / (S.distanceTo(E) + E.distanceTo(H)); hand += H.y; n++;
  }
  return { elbowDeg: elbow / n * 57.2958, drop: drop / n };
}

console.log('\n# Bracos no esqueleto real: parada ela fica com bracos retos e caidos, nao de zumbi');
for (const clip of ['idle', 'look']) for (const side of ['Left', 'Right']) {
  const r = arm(clip, side);
  ok(r.elbowDeg < 35, `${clip} / ${side}: cotovelo quase reto (${r.elbowDeg.toFixed(0)} graus; a pose de zumbi antiga media 84 a 113)`);
  ok(r.drop > 0.85, `${clip} / ${side}: a mao desce ${(r.drop * 100).toFixed(0)}% do comprimento do braco abaixo do ombro (antes 47 a 70%)`);
}
console.log('\n# Andando o balanco continua (nao vira estatua)');
{
  const swing = (clip) => { begin(model, clip); const ys = []; for (let f = 0; f < 90; f++) { model.update(1 / 30, 0, f / 30); if (f < 12) continue; model.rig.updateMatrixWorld(true); const H = B.LeftHand.getWorldPosition(v[2]), S = B.LeftArm.getWorldPosition(v[0]); ys.push(H.clone().sub(S).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(model.group.quaternion))); } return Math.max(...ys) - Math.min(...ys); };
  const w = swing('walk'), r = swing('run');
  ok(w > 0.08, `walk: a mao ainda balanca para frente e para tras (${(w * 100).toFixed(0)} cm de amplitude)`);
  ok(r > 0.08, `run: a mao ainda balanca para frente e para tras (${(r * 100).toFixed(0)} cm de amplitude)`);
}
console.log('\n# Os clipes de acao nao foram tocados (bracos do bote/grito/recuo continuam os do clipe)');
{
  for (const clip of ['attack', 'roar', 'recoil']) { const r = arm(clip, 'Left', 1.5); ok(r.elbowDeg > 25, `${clip}: o braco continua dobrado como no clipe (${r.elbowDeg.toFixed(0)} graus)`); }
}
console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
