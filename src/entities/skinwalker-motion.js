// Anatomy fitting for the authored gaunt Mixamo skinwalker. Only contact and
// finite two-bone IK machinery are inherited; the heavy Guardian performance
// (stance widening, mass restraint, arm styling) is never executed here.
import * as THREE from 'three';
import { GuardianMotion } from './guardian-motion.js';

const SIDES = ['Left', 'Right'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MOVING = /^(walk|run|stalk|creep|limp)$/;
// Quanto os bracos ficam ESTICADOS e CAIDOS ao longo do corpo, por clipe (1 = retos ate quase os joelhos; 0 = pose do clipe). Antes os limites de
// giro (~26 graus) deixavam o cotovelo dobrado com a mao mole para frente: pose de zumbi. Parado ela fica com bracos longos e imoveis, como uma
// entidade; andando e correndo o balanco do clipe continua, so que com os bracos mais retos.
const HANG = { idle: 1, look: 1, stalk: 0.6, creep: 0.6, limp: 0.55, walk: 0.5, run: 0.35 };
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const TOP = /^(Head|Neck|Spine|Hips)/;
const BODY = /^(Head|Neck|Spine|Hips|LeftShoulder|RightShoulder)/;
const BODY_AND_UPPER_ARM = /^(Head|Neck|Spine|Hips|LeftShoulder|RightShoulder|LeftArm$|RightArm$)/;

function localPoint(point, box, out, result) {
  const yaw = box.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const cx = box.cx ?? ((box.x0 ?? box.min?.x ?? 0) + (box.x1 ?? box.max?.x ?? 0)) / 2;
  const cz = box.cz ?? ((box.z0 ?? box.min?.z ?? 0) + (box.z1 ?? box.max?.z ?? 0)) / 2;
  const dx = point.x - cx, dz = point.z - cz;
  out.set(c * dx - s * dz, point.y, s * dx + c * dz);
  result.cx=cx; result.cz=cz; result.c=c; result.s=s;
  result.hx=box.hx ?? ((box.x1 ?? box.max?.x ?? 0) - (box.x0 ?? box.min?.x ?? 0)) / 2;
  result.hz=box.hz ?? ((box.z1 ?? box.max?.z ?? 0) - (box.z0 ?? box.min?.z ?? 0)) / 2;
  result.y0=box.y0 ?? box.min?.y ?? -Infinity; result.y1=box.y1 ?? box.max?.y ?? Infinity;
  return result;
}

export class SkinwalkerMotion extends GuardianMotion {
  constructor(adapter, skeletonData) {
    super(adapter);
    this._bodyBounds = new THREE.Box3(); this._headBounds = new THREE.Box3();
    this._skinPoint = new THREE.Vector3(); this._projectLocal = new THREE.Vector3();
    this._safe = new THREE.Vector3(); this._current = new THREE.Vector3();
    this._boxScratch={}; this._euler=new THREE.Euler(); this._limbQ=new THREE.Quaternion();
    this._collisionPoint=new THREE.Vector3();this._collisionTarget=new THREE.Vector3();this._collisionQ=new THREE.Quaternion();this._collisionPivot=new THREE.Vector3();
    this._hipBase=new THREE.Vector3();
    this._footPose = SIDES.map(() => ({ point: new THREE.Vector3(), q: new THREE.Quaternion() }));
    this._braceTargets = SIDES.map(()=>({active:false,point:new THREE.Vector3()}));
    this._environmentState = null; this.duck = 0;
    const offsets = new Map(skeletonData.names.map((name,i) => [name,new THREE.Vector3().fromArray(skeletonData.offsets[i])]));
    const nativeLeg = SIDES.reduce((sum,s) => sum + offsets.get(s+'Shin').length() + offsets.get(s+'Foot').length(), 0) / 2;
    const targetLeg = SIDES.reduce((sum,s) => sum + this.legs[s].upper + this.legs[s].lower, 0) / 2;
    this.strideScale = targetLeg / nativeLeg;
    this.worldStrideScale = this.strideScale * adapter.sourceRig.getWorldScale(this._v[0]).y;
    this.metrics.profile = 'skinwalker';
    this.metrics.duck = 0; this.metrics.headTopY = 0; this.metrics.worldPenetration = 0;
    this.metrics.braced = 0; this.metrics.braceError = 0; this.metrics.environmentCorrections = 0;
    this.body.nativeLegLength = nativeLeg; this.body.legLength = targetLeg;
  }

  reset() { super.reset(); this.duck = 0; this._environmentState = null; }

  soleY(side) {
    this.rig.root.updateMatrixWorld(true);let y=Infinity;
    for(const sample of this.feet[side].samples){this.rig.sampleSkinWorld(sample,this._v[20]);y=Math.min(y,this._v[20].y);}
    return Number.isFinite(y)?y:this.bones[side+'Foot'].getWorldPosition(this._v[20]).y;
  }

  apply(dt, time, state) {
    this._active = true; this.metrics.heavy = true;
    if (state.clip !== this._clip) {
      for (const s of SIDES) { this.feet[s].active = false; this.feet[s].exhausted = false; }
      this._clip = state.clip;
    }
    this._environmentState = state;
    this.rig._rigPoint(this.bones.Hips,this._hipBase);
    this.metrics.ikReachClamp = 0;
    const moving = MOVING.test(state.clip), crawl = state.clip === 'crawl';
    const requested = clamp(state.clearance?.duck ?? 0, 0, 1);
    // Anticipation is supplied by the shared world sampler. Immediate increase
    // is intentional: stale smoothing must never put the skull into a lintel.
    this.duck = requested >= this.duck ? requested : dt > 0 ? Math.max(requested, this.duck - dt * 2.8) : requested;
    this.metrics.duck = this.duck;
    if (!crawl) {
      // Tiny crooked offsets keep authored native action contours readable.
      // Each joint uses a different slow phase; legs keep their generated gait.
      const style = state.clip === 'attack' || state.clip === 'recoil' || state.clip === 'pain' ? 0.25 : 1;
      this._rotateLocal('Spine', 0.055 * style, 0.018 * style, -0.028 * style);
      this._rotateLocal('Spine1', 0.11 * style, -0.043 * style, 0.035 * style);
      this._rotateLocal('Spine2', 0.075 * style + Math.sin(time * 0.77) * 0.012, 0.023 * style, -0.055 * style);
      this._rotateLocal('Neck', -0.075 * style, -0.12 * style + Math.sin(time * 0.53 + 0.8) * 0.034, 0.13 * style);
      this._rotateLocal('Head', -0.018 * style, 0.048 * style, -0.09 * style + Math.sin(time * 1.17) * 0.014);
      this.rig.root.updateMatrixWorld(true);
      if (this.duck > 0.001) this._duckToCeiling(state);
      this._shapeSkinwalkerArms(time, state, moving);
    }
    this.rig.root.updateMatrixWorld(true);
    this.rig._rigPoint(this.bones.LeftFoot, this._v[0]); this.rig._rigPoint(this.bones.RightFoot, this._v[1]);
    this.metrics.stance = Math.abs(this._v[0].x - this._v[1].x);
    this.rig._rigPoint(this.bones.LeftForeArm, this._v[0]); this.rig._rigPoint(this.bones.RightForeArm, this._v[1]);
    this.metrics.elbows = Math.abs(this._v[0].x - this._v[1].x);
  }

  _rotateLocal(name, x, y, z) {
    const bone = this.bones[name]; if (!bone) return;
    this._q[0].setFromEuler(this._euler.set(x,y,z)); bone.quaternion.multiply(this._q[0]).normalize();
  }

  _duckToCeiling(state) {
    const scale = this.rig.sourceRig.getWorldScale(this._v[0]).y;
    const base = state.floorY ?? state.clearance?.door?.base ?? this.rig.sourceRig.getWorldPosition(this._v[1]).y;
    const ceiling = Number.isFinite(state.clearance?.ceilingY) ? state.clearance.ceilingY : base + 2.2;
    // Reserve measured foot positions before crouching. Hip lowering is body
    // articulation with knee flexion, never root/model scale or long-bone edits.
    for (let i=0;i<2;i++) { this.bones[SIDES[i]+'Foot'].getWorldPosition(this._footPose[i].point); this.bones[SIDES[i]+'Foot'].getWorldQuaternion(this._footPose[i].q); }
    const hips = this.bones.Hips;
    this.rig._rigPoint(hips,this._v[2]); this._v[2].y -= 0.23 / scale * this.duck;
    this._setRigPosition(hips,this._v[2]);
    this._rotateLocal('Hips',0,0.40*this.duck,0);
    this._rotateLocal('Spine',0.28*this.duck,0,0.015*this.duck);
    this._rotateLocal('Spine1',0.37*this.duck,0,-0.018*this.duck);
    this._rotateLocal('Spine2',0.29*this.duck,0,0.018*this.duck);
    this._rotateLocal('Neck',-0.31*this.duck,0,0);
    this.rig.root.updateMatrixWorld(true);
    this.rig._rigQuaternion(this.bones.Neck,this._q[2]);
    this._q[2].premultiply(this._q[0].setFromAxisAngle(this._v[0].set(0,1,0),-0.40*this.duck));
    this.rig._setRigQuaternion(this.bones.Neck,this._q[2]);
    // Actual weighted head/neck/chest extrema, rather than the Head joint,
    // determine the additional safe flexion. Bounded3 iterations per frame.
    for (let i=0;i<3;i++) {
      const top = this.rig.skinBounds(TOP,this._headBounds).max.y;
      const excess = top - (ceiling - 0.055);
      if (excess <= 0) break;
      const bend = clamp(excess * 0.72,0,0.16);
      this._rotateLocal('Spine1',bend,0,0); this._rotateLocal('Spine2',bend*0.75,0,0);
      this.rig._rigPoint(hips,this._v[2]); this._v[2].y -= clamp(excess*0.42,0,0.09) / scale;
      this._setRigPosition(hips,this._v[2]); this.rig.root.updateMatrixWorld(true);
    }
    for (let i=0;i<2;i++) {
      this._solveLimb(SIDES[i],false,this._footPose[i].point,null);
      this._setWorldQuaternion(this.bones[SIDES[i]+'Foot'],this._footPose[i].q);
    }
  }

  _shapeSkinwalkerArms(time,state,moving) {
    const shield = state.clip === 'shield' ? 1 : clamp(state.shield ?? 0,0,1);
    const full = moving || /^(idle|look|inspect)$/.test(state.clip);
    for (const side of SIDES) {
      const sign = side==='Left'?1:-1, upper=this.bones[side+'Arm'], lower=this.bones[side+'ForeArm'], hand=this.bones[side+'Hand'];
      if (shield>0.01) {
        this.rig.headWorld(this._v[0]); hand.getWorldPosition(this._v[1]);
        const scale=this.rig.sourceRig.getWorldScale(this._v[2]).y;
        this._v[2].set(sign*0.11,-0.05+(sign>0?0.025:-0.025),0.15).multiplyScalar(scale).applyQuaternion(this.rig._rigQ).add(this._v[0]);
        this._v[2].lerpVectors(this._v[1],this._v[2],shield);
        upper.getWorldPosition(this._v[5]); this._v[5].add(this._v[6].set(sign*0.24,-0.055,0.14).applyQuaternion(this.rig._rigQ));
        this._solveLimb(side,true,this._v[2],this._v[5]);
        this._aim(hand,this.bones[side+'HandMiddle1'],this._v[0].set(sign*0.06,0.94,0.21),shield,1.7);
      } else if (state.clip==='attack') {
        const reach=smooth(((state.phase??0)-0.1)/0.16)*(1-smooth(((state.phase??0)-0.64)/0.25));
        if (reach>0.01) {
          this.rig._rigPoint(upper,this._v[4]); this.rig._rigPoint(hand,this._v[1]);
          this._v[2].set(sign*0.15,this._v[4].y-0.075+(sign>0?0.035:-0.035),this._v[4].z+(this.arms[side].upper+this.arms[side].lower)*0.91);
          this._v[2].lerpVectors(this._v[1],this._v[2],reach).applyMatrix4(this.rig.sourceRig.matrixWorld);
          this._v[5].copy(this._v[4]).add(this._v[6].set(sign*0.17,-0.15,0.18)).applyMatrix4(this.rig.sourceRig.matrixWorld);
          this._solveLimb(side,true,this._v[2],this._v[5]);
          this._aim(hand,this.bones[side+'HandMiddle1'],this._v[0].set(sign*0.045,-0.07,1),reach,1.8);
        }
      } else if(this.duck>=0.12) {
        this.rig._rigPoint(upper,this._v[4]);this.rig._rigPoint(hand,this._v[1]);
        this._v[2].set(sign*0.22,this._v[4].y-0.28,this._v[4].z+0.21);
        this._v[2].lerpVectors(this._v[1],this._v[2],smooth((this.duck-0.12)/0.55)).applyMatrix4(this.rig.sourceRig.matrixWorld);
        this._v[5].copy(this._v[4]);this._v[5].x=sign*0.28;this._v[5].y-=0.15;this._v[5].z+=0.08;this._v[5].applyMatrix4(this.rig.sourceRig.matrixWorld);
        this._solveLimb(side,true,this._v[2],this._v[5]);
        this._aim(hand,this.bones[side+'HandMiddle1'],this._v[0].set(sign*0.09,-0.92,0.22),this.duck,1.8);
      } else if(full && this.duck<0.12) {
        // Thin dropped arms, one wrist delayed forward and the other behind;
        // native swing supplies the variation, with no broad heavy stance.
        this.rig._rigPoint(lower,this._v[0]); this.rig._rigPoint(hand,this._v[1]);
        const forward=clamp(this._v[1].z-this._v[0].z,-0.24,0.24);
        const k=HANG[state.clip]??0, sway=Math.sin(time*0.63+sign)*0.04;
        this._aim(upper,lower,this._v[2].set(sign*(0.18-0.08*k),-1,forward*0.35*(1-k)+(sign>0?0.08:-0.035)*(1-0.6*k)),0.43+0.52*k,0.46+0.9*k);
        this._aim(lower,hand,this._v[2].set(sign*(0.08-0.03*k),-1,forward*0.9*(1-k)+(sign>0?0.12:-0.06)*(1-0.7*k)),0.28+0.64*k,0.38+1.5*k);
        this._aim(hand,this.bones[side+'HandMiddle1'],this._v[2].set(sign*0.08,-1,(0.10-0.05*k)+sway*(1+k)),0.35+0.55*k,0.45+0.75*k);
      }
    }
  }

  // Project sampled actual skin through the same finite oriented boxes supplied
  // by the shared sampler. The accepted correction is world-space, measurable.
  _project(point,obstacles,out,margin=0.012,horizontal=false) {
    out.copy(point); let penetration=0;
    for(const box of obstacles??[]) {
      if(box.blocking===false)continue;
      const b=localPoint(out,box,this._projectLocal,this._boxScratch), p=this._projectLocal;
      if (!(b.hx>0 && b.hz>0) || p.y<b.y0-margin || p.y>b.y1+margin) continue;
      const dx=b.hx+margin-Math.abs(p.x), dz=b.hz+margin-Math.abs(p.z);
      if(dx<=0 || dz<=0) continue;
      const dy0=p.y-b.y0+margin,dy1=b.y1-p.y+margin;
      const depth=horizontal?Math.min(dx,dz):Math.min(dx,dz,dy0,dy1); penetration=Math.max(penetration,depth);
      // Trailing feet can still overlap an open leaf after the body has left
      // the duck/brace envelope. Its own source door remains authoritative
      // even when no doorway is selected for the upper-body pose anymore.
      const door=box.kind==='doorLeaf' ? box.source ?? this._environmentState?.clearance?.door : this._environmentState?.clearance?.door;
      if(door && box.kind==='doorLeaf') {
        // The nearest side of an open leaf can face straight into its hinge
        // wall. Always reserve the side facing the accessible opening; this
        // prevents an IK point oscillating between the leaf and adjacent jamb.
        const side=(b.s*(door.cx-b.cx)+b.c*(door.cz-b.cz))<0?-1:1;
        p.z=side*(b.hz+margin);
        out.x=b.cx+b.c*p.x+b.s*p.z;out.z=b.cz-b.s*p.x+b.c*p.z;continue;
      }
      const horizontalDoor=door?.axis==='h'||door?.axis==='z';
      const architecture=box.kind==='jamb'||box.kind==='doorFrame'||box.kind==='wall';
      if(door && architecture && Math.abs((horizontalDoor?b.cz:b.cx)-(horizontalDoor?door.cz:door.cx))<0.3 && b.y1-b.y0>1) {
        if(horizontalDoor)out.x=door.cx<b.cx?b.cx-b.hx-margin:b.cx+b.hx+margin;
        else out.z=door.cz<b.cz?b.cz-b.hz-margin:b.cz+b.hz+margin;
        continue;
      }
      if(depth===dy1) out.y=b.y1+margin;
      else if(depth===dy0) out.y=b.y0-margin;
      else {
        if(dx<dz) p.x=(p.x<0?-1:1)*(b.hx+margin); else p.z=(p.z<0?-1:1)*(b.hz+margin);
        out.x=b.cx+b.c*p.x+b.s*p.z; out.z=b.cz-b.s*p.x+b.c*p.z;
      }
    }
    return penetration;
  }

  _braceDoor(state) {
    const door=state.clearance?.door;
    if(!door || this.duck<0.12 || door.closed || door.blocked || door.blocking || door.locked) return;
    const base=door.base ?? state.floorY ?? 0;
    for(const side of SIDES) {
      const hand=this.bones[side+'Hand'], upper=this.bones[side+'Arm'];
      const jl=door.jambLeft,jr=door.jambRight;
      upper.getWorldPosition(this._v[4]);
      const dl=jl?Math.hypot(this._v[4].x-jl.x,this._v[4].z-jl.z):Infinity;
      const dr=jr?Math.hypot(this._v[4].x-jr.x,this._v[4].z-jr.z):Infinity;
      const jamb=dl<dr?jl:jr; if(!jamb || jamb.accessible===false) continue;
      hand.getWorldPosition(this._current);
      this._safe.set(jamb.x,base+1.52+(side==='Left'?0.045:-0.035),jamb.z);
      if(jamb.nx!==undefined){this._safe.x+=jamb.nx*0.045;this._safe.z+=jamb.nz*0.045;}
      // Jamb can only be touched while inside the real arm reach.
      upper.getWorldPosition(this._v[4]);
      const reach=(this.arms[side].upper+this.arms[side].lower)*this.rig.sourceRig.getWorldScale(this._v[3]).y;
      if(this._v[4].distanceTo(this._safe)>reach*0.985) continue;
      this._safe.lerpVectors(this._current,this._safe,smooth((this.duck-0.12)/0.5));
      const sign=side==='Left'?1:-1;
      this._v[5].lerpVectors(this._v[4],this._safe,0.5);
      if(jamb.nx!==undefined) this._v[5].add(this._v[6].set(jamb.nx*0.27,-0.09,jamb.nz*0.27));
      else this._v[5].add(this._v[6].set(sign*0.08,-0.12,-0.24).applyQuaternion(this.rig._rigQ));
      this._solveLimb(side,true,this._safe,this._v[5]);
      // Long nails follow the wall tangent, avoiding a fingertip spear into
      // the wall. The measured hand/nail skin owns its final surface offset.
      if(jamb.tx!==undefined)this._v[2].set(jamb.tx,0.06,jamb.tz).applyQuaternion(this.rig._rigQInv);
      else this._v[2].set(sign*-0.1,0.97,0.08);
      this._aim(hand,this.bones[side+'HandMiddle1'],this._v[2],1,Math.PI);
      hand.getWorldPosition(this._v[3]);
      this.metrics.braced++; this.metrics.braceError=Math.max(this.metrics.braceError,this._v[3].distanceTo(this._safe));
      const record=this._braceTargets[side==='Left'?0:1];record.active=true;record.point.copy(this._safe);
    }
  }

  resolveEnvironment(state=this._environmentState??{}) {
    this.rig.sourceRig.updateMatrixWorld(true); this.rig._captureRigTransform();
    this.metrics.braced=0; this.metrics.braceError=0; this.metrics.environmentCorrections=0;
    for(const record of this._braceTargets)record.active=false;
    this._fitFinalCeiling(state);
    this._braceDoor(state);
    const obstacles=state.clearance?.obstacles??[];
    // Whole-body lateral correction is confined to articulation at the hips.
    // Feet are solved back to their previous world positions afterwards.
    for(let i=0;i<2;i++) { this.bones[SIDES[i]+'Foot'].getWorldPosition(this._footPose[i].point); this.bones[SIDES[i]+'Foot'].getWorldQuaternion(this._footPose[i].q); }
    for(let pass=0;pass<5;pass++) {
      this.rig.root.updateMatrixWorld(true);
      this._v[22].set(0,0,0); let count=0,deepest=0;
      for(const sample of this.rig.skinSamples) {
        if(!BODY.test(sample.bone)) continue;
        this.rig.sampleSkinWorld(sample,this._skinPoint);
        const depth=this._project(this._skinPoint,obstacles,this._safe,0.025);
        if(depth>deepest) { this._v[22].subVectors(this._safe,this._skinPoint);deepest=depth;count++; }
      }
      if(!count) break;
      this._v[22].y=clamp(this._v[22].y,-0.06,0.02);
      if(this._v[22].length()>0.12) this._v[22].setLength(0.12);
      this.bones.Hips.getWorldPosition(this._v[2]); this._v[2].add(this._v[22]);
      this.bones.Hips.parent.worldToLocal(this._v[2]); this.bones.Hips.position.copy(this._v[2]);
      this.rig.root.updateMatrixWorld(true); this.metrics.environmentCorrections++;
    }
    for(let i=0;i<2;i++) { this._solveLimb(SIDES[i],false,this._footPose[i].point,null); this._setWorldQuaternion(this.bones[SIDES[i]+'Foot'],this._footPose[i].q); }
    this._fitFinalCeiling(state);
    for(const side of SIDES) { this._fitLimbSkin(side,true,obstacles);this._fitLimbSkin(side,false,obstacles); }
    // Skin around the clavicle blends Arm and Spine weights. Refine those
    // actual shoulder extrema after wrist IK, without editing bone offsets.
    for(let pass=0;pass<4;pass++) {
      this.rig.root.updateMatrixWorld(true);let deepest=0;this._v[22].set(0,0,0);
      for(const sample of this.rig.skinSamples) {
        if(!BODY_AND_UPPER_ARM.test(sample.bone))continue;
        this.rig.sampleSkinWorld(sample,this._skinPoint);
        const depth=this._project(this._skinPoint,obstacles,this._safe,0.025,true);
        if(depth>deepest){deepest=depth;this._v[22].subVectors(this._safe,this._skinPoint);}
      }
      if(deepest<=0)break;
      if(this._v[22].length()>0.10)this._v[22].setLength(0.10);
      this.bones.Hips.getWorldPosition(this._v[2]);this._v[2].add(this._v[22]);this.bones.Hips.parent.worldToLocal(this._v[2]);this.bones.Hips.position.copy(this._v[2]);
      this.rig.root.updateMatrixWorld(true);
      for(const side of SIDES)this._fitLimbSkin(side,false,obstacles);
      this.metrics.environmentCorrections++;
    }
    for(const side of SIDES)this._fitLowerArmSkin(side,obstacles);
    this.rig.root.updateMatrixWorld(true); let penetration=0;
    for(const sample of this.rig.skinSamples) {
      this.rig.sampleSkinWorld(sample,this._skinPoint);
      const p=this._project(this._skinPoint,obstacles,this._safe,0);
      if(p>penetration) { penetration=p; this.metrics.penetratingBone=sample.bone; }
    }
    this.metrics.worldPenetration=penetration;
    this.metrics.headTopY=this.rig.skinBounds(TOP,this._headBounds).max.y;
    this.rig._rigPoint(this.bones.Hips,this._v[1]);
    this.metrics.bodyShift=Math.hypot(this._v[1].x-this._hipBase.x,this._v[1].z-this._hipBase.z)*this.rig.sourceRig.getWorldScale(this._v[0]).y;
    this.metrics.braced=0;this.metrics.braceError=0;this.metrics.braceAttemptError=0;
    for(let i=0;i<2;i++)if(this._braceTargets[i].active) {
      this.bones[SIDES[i]+'Hand'].getWorldPosition(this._current);
      const error=this._current.distanceTo(this._braceTargets[i].point);
      this.metrics.braceAttemptError=Math.max(this.metrics.braceAttemptError,error);
      if(error<0.09){this.metrics.braced++;this.metrics.braceError=Math.max(this.metrics.braceError,error);}
    }
  }

  _fitLowerArmSkin(side,obstacles) {
    if(!obstacles.length)return;
    const hand=this.bones[side+'Hand'],lower=this.bones[side+'ForeArm'];
    for(let pass=0;pass<12;pass++) {
      this.rig.root.updateMatrixWorld(true);let max=0;this._v[22].set(0,0,0);
      for(const sample of this.rig.skinSamples) {
        if(!sample.bone.startsWith(side+'Hand')&&sample.bone!==side+'ForeArm')continue;
        this.rig.sampleSkinWorld(sample,this._skinPoint);
        const p=this._project(this._skinPoint,obstacles,this._safe,0.025,true);
        if(p>max){max=p;this._v[22].subVectors(this._safe,this._skinPoint);}
      }
      if(max<=0)break;
      lower.getWorldPosition(this._collisionPivot);hand.getWorldPosition(this._current);hand.getWorldQuaternion(this._limbQ);
      this._safe.copy(this._current).add(this._v[22]);
      this._v[19].subVectors(this._current,this._collisionPivot).normalize();this._v[20].subVectors(this._safe,this._collisionPivot).normalize();
      this._collisionQ.setFromUnitVectors(this._v[19],this._v[20]);
      const angle=this._collisionQ.angleTo(this._q[1].identity());if(angle>0.24)this._collisionQ.slerp(this._q[1],1-0.24/angle);
      lower.getWorldQuaternion(this._q[3]);this._q[3].premultiply(this._collisionQ);this._setWorldQuaternion(lower,this._q[3]);this._setWorldQuaternion(hand,this._limbQ);
      this.metrics.environmentCorrections++;
    }
  }

  _fitLimbSkin(side,arm,obstacles) {
    if(!obstacles.length) return;
    const names=arm?[side+'Arm',side+'ForeArm',side+'Hand']:[side+'UpLeg',side+'Leg',side+'Foot',side+'Toe'];
    const end=this.bones[side+(arm?'Hand':'Foot')],middle=this.bones[side+(arm?'ForeArm':'Leg')];
    for(let pass=0;pass<10;pass++) {
      this.rig.root.updateMatrixWorld(true);let max=0,worstBone='';this._v[22].set(0,0,0);
      for(const sample of this.rig.skinSamples) {
        if(!names.some(n=>sample.bone.startsWith(n))) continue;
        this.rig.sampleSkinWorld(sample,this._skinPoint);
        const p=this._project(this._skinPoint,obstacles,this._safe,0.03,true);
        if(p>max) {max=p;this._v[22].subVectors(this._safe,this._skinPoint);worstBone=sample.bone;this._collisionPoint.copy(this._skinPoint);this._collisionTarget.copy(this._safe);}
      }
      if(max<=0) break;
      if(this._v[22].length()>0.18)this._v[22].setLength(0.18);
      end.getWorldPosition(this._v[2]);end.getWorldQuaternion(this._limbQ);
      this._v[2].add(this._v[22]);middle.getWorldPosition(this._v[5]);this._v[5].addScaledVector(this._v[22],1.7);
      this._solveLimb(side,arm,this._v[2],this._v[5]);this._setWorldQuaternion(end,this._limbQ);
      if(arm && pass>=2) {
        const affected=this.bones[worstBone.startsWith(side+'Hand')?side+'Hand':worstBone];
        if(affected) {
          affected.getWorldPosition(this._collisionPivot);
          this._v[19].subVectors(this._collisionPoint,this._collisionPivot);this._v[20].subVectors(this._collisionTarget,this._collisionPivot);
          if(this._v[19].lengthSq()>1e-6 && this._v[20].lengthSq()>1e-6) {
            this._collisionQ.setFromUnitVectors(this._v[19].normalize(),this._v[20].normalize());
            const angle=this._collisionQ.angleTo(this._q[1].identity());
            if(angle>0.28)this._collisionQ.slerp(this._q[1],1-0.28/angle);
            affected.getWorldQuaternion(this._limbQ);this._limbQ.premultiply(this._collisionQ);this._setWorldQuaternion(affected,this._limbQ);
          }
        }
      }
      if(!arm && this.feet[side].active)end.getWorldPosition(this.feet[side].target);
      this.metrics.environmentCorrections++;
    }
  }

  _fitFinalCeiling(state) {
    const ceiling=state.clearance?.ceilingY;
    if(this.duck<0.01 || !Number.isFinite(ceiling)) return;
    for(let i=0;i<2;i++) { this.bones[SIDES[i]+'Foot'].getWorldPosition(this._footPose[i].point); this.bones[SIDES[i]+'Foot'].getWorldQuaternion(this._footPose[i].q); }
    const scale=this.rig.sourceRig.getWorldScale(this._v[0]).y;
    for(let pass=0;pass<4;pass++) {
      const excess=this.rig.skinBounds(TOP,this._headBounds).max.y-(ceiling-0.06);
      if(excess<=0.001) break;
      this._rotateLocal('Spine1',clamp(excess*0.50,0,0.11),0,0);
      this._rotateLocal('Spine2',clamp(excess*0.28,0,0.065),0,0);
      this.rig._rigPoint(this.bones.Hips,this._v[2]);this._v[2].y-=clamp(excess*0.65,0,0.085)/scale;
      this._setRigPosition(this.bones.Hips,this._v[2]);this.rig.root.updateMatrixWorld(true);
    }
    for(let i=0;i<2;i++) { this._solveLimb(SIDES[i],false,this._footPose[i].point,null);this._setWorldQuaternion(this.bones[SIDES[i]+'Foot'],this._footPose[i].q); }
  }

  ground(dt,floorY,state) {
    super.ground(dt,floorY,{...state,heavy:true});
    // Contact IK may change thigh/arm separation. Final world skin checks run
    // after it, as they do after the upper-body action and finger animation.
    this.resolveEnvironment(state);
    // The public model damps its root-to-floor correction. A released foot
    // must nevertheless clear the floor on the very first moving frame.
    // Lift its actual weighted sole with leg IK, retaining the authored heel
    // rotation and toe roll; do not wait for a new contact/plant to fix it.
    for(let pass=0;pass<2;pass++)for(const side of SIDES) {
      const sole=this.soleY(side);if(sole>=floorY-0.003)continue;
      const foot=this.bones[side+'Foot'],toe=this.bones[side+'ToeBase'];
      foot.getWorldPosition(this._safe);this._safe.y+=floorY-sole+0.003;
      foot.getWorldQuaternion(this._limbQ);toe?.getWorldQuaternion(this._collisionQ);
      this._solveLimb(side,false,this._safe,null);this._setWorldQuaternion(foot,this._limbQ);
      if(toe)this._setWorldQuaternion(toe,this._collisionQ);
      if(this.feet[side].active)foot.getWorldPosition(this.feet[side].target);
      this._fitLimbSkin(side,false,state.clearance?.obstacles??[]);
    }
    this.rig.root.updateMatrixWorld(true);
  }
}
