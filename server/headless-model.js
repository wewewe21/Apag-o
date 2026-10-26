// "Modelo" da criatura no servidor: nao desenha nada, mas oferece a mesma interface que a IA usa no cliente
// (posicao da cabeca/peito, clipe atual e seus tempos, root motion do recuo). O visual roda no cliente a partir do estado.
import * as THREE from 'three';
import { sampleCreatureClearance, projectBodyOutOfObstacles } from '../src/shared/creature-clearance.js';

export class HeadlessCreatureModel {
  constructor(anim) {
    this.anim = anim;
    this.profile = anim.profile;
    this.clearance = {}; this._motionPosition = new THREE.Vector3(); this._motionSpeed=0;
    this.group = { position: new THREE.Vector3(), rotation: { y: 0 }, visible: false };
    this.actions = {};
    for (const n of anim.names) this.actions[n] = { time: 0, timeScale: 1, setEffectiveTimeScale(v) { this.timeScale = v; }, isRunning: () => false };
    this.current = 'idle'; this.playSeq = 0; this.oneshotT = 0;
    this.eyeshine = 0; this.burnGlow = 0; this.jawOpen = 0.2; this.shield = 0;
    this.lookTarget = null; this.lookWeight = 0;
    this.flinchSeq = 0;
  }
  clipSpeed(n) { return this.anim.clipSpeed(n); }
  duration(n) { return this.anim.duration(n); }
  rootAt(n, t) { return this.anim.rootAt(n, t); }
  play(name, fade = 0.3, opts = {}) {
    if (!this.actions[name]) return;
    if (this.current === name && !opts.restart) return;
    this.current = name; this.playSeq++;
    const a = this.actions[name]; a.time = 0; a.timeScale = opts.timeScale ?? 1;
  }
  setShield(w) { this.shield = w; }
  flinch() { this.flinchSeq++; return true; }     // a reacao de dor e so visual: o cliente a reproduz ao ver `burning`
  cancelFlinch() {}
  setEnvironment(grid) { this.environment=grid; this._motionPosition.copy(this.group.position); }
  colliderReach() { return this.profile?.anatomy?.clips?.[this.current]?.headReach ?? null; }
  // avanca o tempo do clipe atual (o recuo usa isto para o root motion)
  update(dt) {
    const a = this.actions[this.current]; if (!a) return;
    const c = this.anim.clips[this.current];
    a.time += dt * a.timeScale;
    const dur = this.anim.duration(this.current);
    if (c.loop) a.time %= dur; else a.time = Math.min(a.time, dur);
    if(this.environment && this.profile?.profile==='skinwalker') {
      const moved=this.group.position.distanceTo(this._motionPosition);
      if(dt>0&&moved<2)this._motionSpeed+=(moved/dt-this._motionSpeed)*(1-Math.exp(-dt*12));
      this._motionPosition.copy(this.group.position);
      sampleCreatureClearance(this.environment,this.group.position.x,this.group.position.z,this.group.rotation.y,
        this.group.position.y,this._motionSpeed,dt,this.clearance);
    }
    this.afterPose?.();
  }
  // posicao da cabeca/peito: medias medidas no modelo real de cada clipe (altura, avanco para a frente do corpo)
  headWorld(out = new THREE.Vector3()) {
    if(this._measuredMarker(out,0))return out;
    const [h, f] = HEAD[this.current] || HEAD.idle, y = this.group.rotation.y, p = this.group.position;
    return out.set(p.x + Math.sin(y) * f, p.y + h, p.z + Math.cos(y) * f);
  }
  chestWorld(out = new THREE.Vector3()) {
    if(this._measuredMarker(out,3))return out;
    const [h, f] = CHEST[this.current] || CHEST.idle, y = this.group.rotation.y, p = this.group.position;
    return out.set(p.x + Math.sin(y) * f, p.y + h, p.z + Math.cos(y) * f);
  }
  _measuredMarker(out,offset) {
    const anatomy=this.profile?.anatomy,clip=anatomy?.clips?.[this.current];
    if(!clip)return false;
    const phase=(this.actions[this.current]?.time??0)/this.duration(this.current),n=anatomy.sampleCount;
    const loop=this.anim.clips[this.current]?.loop;
    const f=loop?(((phase%1)+1)%1)*n:Math.min(n-1,Math.max(0,phase*n)),i=Math.floor(f),k=f-i;
    const j=loop?(i+1)%n:Math.min(n-1,i+1);
    const duck=Math.min(1,Math.max(0,this.clearance.duck??0))*2,d=Math.min(1,Math.floor(duck)),w=duck-d;
    const a=clip.poses[d],b=clip.poses[d+1];
    const v=axis=>THREE.MathUtils.lerp(THREE.MathUtils.lerp(a[i][offset+axis],a[j][offset+axis],k),THREE.MathUtils.lerp(b[i][offset+axis],b[j][offset+axis],k),w);
    const x=v(0),y=v(1),z=v(2),yaw=this.group.rotation.y,p=this.group.position;
    out.set(p.x+Math.cos(yaw)*x+Math.sin(yaw)*z,p.y+y,p.z-Math.sin(yaw)*x+Math.cos(yaw)*z);
    // The client articulates its long neck around nearby geometry after
    // retargeting. Apply the same physical bounds to this measured head anchor
    // instead of using an unadapted source pose to shove the navigation root.
    if(offset===0 && this.environment) {
      const [qx,qz]=this.environment.collideCircle(out.x,out.z,CREATURE.headRadius,{ignore:b=>!b.vision});
      out.x=qx;out.z=qz;
      const projected=this._headProjection||(this._headProjection={});
      projectBodyOutOfObstacles(out,CREATURE.headRadius,out.y-.14,out.y+.14,this.clearance.obstacles,projected);
      out.x=projected.x;out.z=projected.z;
    }
    return true;
  }
}

import { CREATURE } from '../src/config.js';
const HEIGHT = { idle: 1.8, walk: 1.48, creep: 1.84, limp: 2.15, stalk: 1.59, run: 1.28, look: 2.02, inspect: 1.45, crawl: 1.15, roar: 1.9, recoil: 1.46, attack: 1.66 };
const HEAD = Object.fromEntries(Object.entries(HEIGHT).map(([k, y]) => [k, [y, CREATURE.headReach[k]]]));     // [altura, alcance a frente] (alcance = mesma tabela da colisao)
const CHEST = { idle: [1.75, 0.25], creep: [1.83, 0.18], walk: [1.68, 0.28], limp: [1.84, 0.22], stalk: [1.58, 0.28], run: [1.53, 0.23], look: [1.82, 0.2], inspect: [1.51, 0.34], crawl: [1.48, 0.41], roar: [1.73, 0.24], recoil: [1.62, 0.23], attack: [1.65, 0.2] };
