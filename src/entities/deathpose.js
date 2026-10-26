// Camada de pose da CENA DE MORTE (so no cliente): curva o tronco e o pescoco da criatura sobre o jogador e leva as maos aos ombros dele.
// Nenhum clipe do jogo tem bote ou agarrao (o "attack" quase nao mexe), entao esta camada e aplicada por cima do clipe atual,
// em dois pontos do CreatureModel.update:
//   applySoma  - ANTES do retarget (esqueleto SOMA, eixos conhecidos): dobra do tronco, pescoco e tremor. A cabeca continua mirando o jogador (_aimHead).
//   applyFbx   - DEPOIS do retarget (ossos do FBX): maos nos ombros do jogador por IK e quadril afundado (as pernas ficam escondidas no chao).
// Quem define os numeros a cada quadro e a DeathScene; aqui so existe a pose.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const SIDES = ['Left', 'Right'];
// como a dobra para frente se reparte pelos ossos SOMA (soma = 1); foldMax e o angulo total (rad) com fold = 1
const FOLD = [['Spine1', 0.34], ['Spine2', 0.30], ['Chest', 0.22], ['Neck1', 0.08], ['Neck2', 0.06]];
export const POSE = { foldMax: 1.45, neckMax: 0.7, headComp: 0.85 };

export class DeathPose {
  constructor(model) {
    this.m = model;
    this.hands = [new THREE.Vector3(), new THREE.Vector3()];     // onde cada mao (esquerda, direita da CRIATURA) deve parar
    this.grab = new THREE.Vector3();                              // ponto para onde os dedos apontam (pescoco do jogador)
    this._q = new THREE.Quaternion(); this._id = new THREE.Quaternion(); this._hq = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._v = Array.from({ length: 7 }, () => new THREE.Vector3());
    this.reset();
  }

  reset() {
    this.on = false;
    this.fold = 0;       // 0..1: dobra o tronco para frente (1 = ~83 graus na cintura)
    this.neck = 0;       // 0..1: pescoco se projeta alem da dobra (bote final)
    this.reach = 0;      // 0..1: bracos vao das posicoes do clipe ate os ombros do jogador
    this.shake = 0;      // 0..1: tremor violento do corpo
    this.sink = 0;       // m: quadril desce (as pernas atravessam o piso, que as esconde da camera)
    this.tilt = 0;       // rad: a cabeca se inclina de lado (o rosto continua olhando o jogador): estranho, nada humano
    this.splay = 0;      // 0..1: dedos esticados e bem abertos (aranha), em vez de garra curvada de zumbi
  }

  // esqueleto SOMA: eixo X local = inclinar para frente (e o que a postura corcunda do modelo antigo usava)
  applySoma(time) {
    const b = this.m.bones, q = this._q;
    if (this.fold > 0) for (const [name, w] of FOLD) b[name].quaternion.multiply(q.setFromAxisAngle(X, this.fold * POSE.foldMax * w));
    if (this.neck > 0) {
      b.Neck1.quaternion.multiply(q.setFromAxisAngle(X, this.neck * POSE.neckMax * 0.55));
      b.Neck2.quaternion.multiply(q.setFromAxisAngle(X, this.neck * POSE.neckMax * 0.45));
    }
    // a cabeca desfaz quase toda a dobra: o rosto fica de frente para o jogador (o resto o _aimHead acerta), como um abutre que ergue o bico
    const bent = this.fold * POSE.foldMax + this.neck * POSE.neckMax;
    if (bent > 0) b.Head.quaternion.multiply(q.setFromAxisAngle(X, -bent * POSE.headComp));
    if (this.tilt !== 0) b.Head.quaternion.multiply(q.setFromAxisAngle(Z, this.tilt));          // depois da compensacao: gira em torno do eixo do rosto (inclina de lado, sem virar o rosto)
    if (this.shake > 0) {
      const s = this.shake, e = this._e;
      // duas senoides nao harmonicas por eixo: sacode como um boneco, sem parecer um ciclo
      const n = (f1, f2, p) => Math.sin(time * f1 + p) * 0.65 + Math.sin(time * f2 + p * 2.3) * 0.35;
      b.Spine1.quaternion.multiply(q.setFromEuler(e.set(n(41, 63, 0.2) * 0.03 * s, n(37, 59, 1.1) * 0.06 * s, n(47, 71, 2.4) * 0.05 * s)));
      b.Chest.quaternion.multiply(q.setFromEuler(e.set(n(53, 79, 3.3) * 0.03 * s, n(43, 67, 0.7) * 0.07 * s, n(39, 61, 1.9) * 0.06 * s)));
      b.Neck2.quaternion.multiply(q.setFromEuler(e.set(n(59, 83, 2.2) * 0.05 * s, n(49, 73, 0.4) * 0.07 * s, n(51, 77, 3.0) * 0.06 * s)));
    }
  }

  // ossos do FBX, ja retargetados e com o chao resolvido
  applyFbx(dt, time) {
    const m = this.m, motion = m.guardian?.motion, B = m.guardian?.bones;
    if (!motion?._solveLimb || !B) return;
    m.rig.updateMatrixWorld(true);
    const [S, H, T, OUT, POLE] = this._v;
    const yaw = m.group.rotation.y;
    if (this.reach > 0.001) {
      for (let i = 0; i < 2; i++) {
        const side = SIDES[i], arm = B[side + 'Arm'], hand = B[side + 'Hand'], mid = B[side + 'HandMiddle1'];
        if (!arm || !hand) continue;
        arm.getWorldPosition(S); hand.getWorldPosition(H);
        T.lerpVectors(H, this.hands[i], this.reach);
        // cotovelo para fora e um pouco para cima: garras abertas, como quem agarra
        OUT.set(Math.cos(yaw) * (side === 'Left' ? 1 : -1), 0, -Math.sin(yaw) * (side === 'Left' ? 1 : -1));
        POLE.copy(S).addScaledVector(OUT, 0.55); POLE.y += 0.25;
        motion._solveLimb(side, true, T, POLE);
        // dedos apontam para o pescoco do jogador (so na segunda metade do alcance)
        if (mid && this.reach > 0.5) {
          hand.getWorldPosition(H); mid.getWorldPosition(S);
          this._v[5].subVectors(S, H).normalize(); this._v[6].subVectors(this.grab, H).normalize();
          this._q.setFromUnitVectors(this._v[5], this._v[6]).slerp(this._id, 1 - clamp((this.reach - 0.5) * 2, 0, 1) * 0.8);
          hand.getWorldQuaternion(this._hq).premultiply(this._q);
          motion._setWorldQuaternion(hand, this._hq);
        }
      }
    }
    // dedos longos, esticados e muito abertos: segurando o crânio como uma aranha, nada de garra caida
    if (this.splay > 0.01 && m.guardian.fingers) {
      for (const f of m.guardian.fingers) {
        const t = this._hq.copy(f.bind).multiply(this._q.setFromAxisAngle(f.axis, -0.1));
        if (f.digit > 0 && f.joint <= 2) t.multiply(this._q.setFromAxisAngle(f.spreadAxis, (f.digit - 2.5) * (f.joint === 1 ? 0.3 : 0.12)));
        f.bone.quaternion.slerp(t, this.splay);
      }
    }
    if (this.sink > 0) m.rig.position.y -= this.sink / m.group.scale.y;
    m.rig.updateMatrixWorld(true);
  }
}
