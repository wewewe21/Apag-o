import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { parseSkinwalkerForInspection, measureSkinwalker } from '../skinwalker-asset-inspect.mjs';
import { createGuardianInstance } from '../../src/entities/guardian-asset.js';
import { GuardianRig } from '../../src/entities/guardian-rig.js';
import { CreatureModel } from '../../src/entities/creature.js';
import { Grid } from '../../src/world/grid.js';
import { DoorCore } from '../../src/world/doorcore.js';
import { sampleCreatureClearance, pointObstaclePenetration } from '../../src/shared/creature-clearance.js';

const data=JSON.parse(fs.readFileSync(new URL('../../assets/anim/creature.json',import.meta.url),'utf8'));
const {asset,sha256}=await parseSkinwalkerForInspection();
assert.equal(sha256,'1d99d6f111cda964c51db3e5241203559cb41b73646338a3e79ceaffa8d446f0');
const authored=measureSkinwalker(asset);
assert.equal(authored.bones,65); assert.equal(authored.meshes[0].skeletonBones,52);
assert.equal(authored.textures.length,1); assert.ok(authored.arms.every(a=>a.digits.every(d=>d.length>0.22)));
const legacy=createGuardianInstance(asset);
assert.ok(Math.abs(new THREE.Box3().setFromObject(legacy,true).getSize(new THREE.Vector3()).y-1.75)<1e-6,'existing normalization default retained');
const root=new THREE.Group(), source=new THREE.Group(); root.add(source); source.scale.setScalar(1.3);
const target=createGuardianInstance(asset,{height:3/1.3,profile:'skinwalker'}); source.add(target);
const sourceBones={}, list=data.skeleton.names.map((n,i)=>{const b=new THREE.Bone();b.name=n;b.position.fromArray(data.skeleton.offsets[i]);sourceBones[n]=b;return b;});
list.forEach((b,i)=>(data.skeleton.parents[i]<0?source:list[data.skeleton.parents[i]]).add(b));
root.updateMatrixWorld(true);
assert.ok(Math.abs(new THREE.Box3().setFromObject(target,true).getSize(new THREE.Vector3()).y-3)<1e-6,'authored bind height exactly3m');
const bindHashes=[];
target.traverse(mesh=>{if(mesh.isSkinnedMesh)bindHashes.push({mesh,geometry:geometryHash(mesh.geometry),inverse:mesh.skeleton.boneInverses.map(m=>m.toArray()),order:mesh.skeleton.bones.map(b=>b.uuid),matrix:mesh.bindMatrix.toArray()});});
const rig=new GuardianRig(source,sourceBones,target,data.skeleton);
assert.equal(rig.motion.constructor.name,'SkinwalkerMotion'); assert.equal(rig.profile,'skinwalker');
assert.ok(rig.strideScale>1.1&&rig.strideScale<2); assert.equal(target.userData.guardianAsset.strideScale,rig.strideScale);
assert.equal(rig.fingers.length,30); assert.ok(rig.skinSamples.length>1000&&rig.skinSamples.length<6000,`bounded slicedskin probes${rig.skinSamples.length}`);
const clips=Object.fromEntries(Object.entries(data.clips).filter(([,c])=>c.rot).map(([n,c])=>[n,{...c,rotValues:decode(c.rot,32767),rootValues:decode(c.root,1000)}]));
const layer=data.guardianMotion?.visualLayers?.doorway,layerRot=layer?.rot?decode(layer.rot,32767):null,layerQ=new THREE.Quaternion();
const state={heavy:true,profile:'skinwalker',clip:'idle',phase:0,contacts:{left:0,right:0},floorY:0};
let maxSoleError=0,maxSkinError=0,maxCachedError=0,minSelf=Infinity,headTravel=0,footTravel=0,previousHead,previousFoot;
const samples=[];
for(const [name,clip] of Object.entries(clips)) {
  rig.resetMotion(); root.position.set(0,0,0); root.rotation.y=0;
  let travel=0,previous;
  for(let f=0;f<clip.frames;f+=4) {
    sample(name,f);state.clip=name;state.phase=f/clip.frames;state.clearance=null;
    state.contacts.left=clip.contacts?.left?.[f]??0;state.contacts.right=clip.contacts?.right?.[f]??0;
    rig.update(4/data.fps,f/data.fps,state); floor(4/data.fps);
    const p=rig.headWorld();if(previous)travel+=p.distanceTo(previous);previous=p;
    assertFinite();minSelf=Math.min(minSelf,rig.metrics.afterClearance);
    maxSoleError=Math.max(maxSoleError,Math.abs(rig.supportY()));
    assert.ok(rig.metrics.maxCorrection<=0.461);
  }
  assert.ok(travel>0.008,`${name} real head motion`); samples.push({name,headTravel:+travel.toFixed(4)});
}

// Retargeted native gait and world plants are sampled while its root advances;
// pelvis, feet and clip time all change. A static-root-only check cannot pass.
rig.resetMotion(); state.clip='walk';state.clearance=null;
root.position.set(2,0,-3);root.rotation.y=0.45;
for(let f=0;f<120;f++) {
  const c=clips.walk,frame=f%c.frames; sample('walk',frame);
  root.position.x+=Math.sin(root.rotation.y)*0.008;root.position.z+=Math.cos(root.rotation.y)*0.008;
  state.phase=frame/c.frames;state.contacts.left=c.contacts?.left?.[frame]??0;state.contacts.right=c.contacts?.right?.[frame]??0;
  rig.update(1/data.fps,f/data.fps,state);floor(1/data.fps);
  const h=rig.headWorld(),p=rig.bones.LeftFoot.getWorldPosition(new THREE.Vector3());
  if(previousHead)headTravel+=h.distanceTo(previousHead);if(previousFoot)footTravel+=p.distanceTo(previousFoot);
  previousHead=h;previousFoot=p; assertFinite();
}
assert.ok(headTravel>0.25&&footTravel>0.25,'moving native gait continues');

// Exact dense skin, including nails, is an independent check of probe coverage.
function exactBounds(region=/./) {
  const result=new THREE.Box3(),p=new THREE.Vector3();target.updateMatrixWorld(true);
  target.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const w=mesh.geometry.attributes.skinWeight,idx=mesh.geometry.attributes.skinIndex;
    for(let i=0;i<w.count;i++){let j=0,best=0;for(let k=0;k<4;k++)if(w.getComponent(i,k)>best){best=w.getComponent(i,k);j=idx.getComponent(i,k);} const n=mesh.skeleton.bones[j].name.replace(/^.*mixamorig[:_]?/i,'').replace(/[:_]/g,'');if(!region.test(n))continue;
      mesh.getVertexPosition(i,p);mesh.localToWorld(p);result.expandByPoint(p);
    }});return result;
}
const doorwaySamples=[];
for(const axis of ['x','z']) for(const direction of [-1,1]) for(const base of [0,-2.6]) {
  rig.resetMotion(); state.clip='walk';state.floorY=base;root.position.set(0,base,0);root.rotation.y=axis==='x'?direction*Math.PI/2:direction<0?Math.PI:0;
  const tangent=axis==='x'?'z':'x';
  const door={cx:0,cz:0,axis,width:1.07,base,ceilingY:base+2.2,signedDistance:0,approachSide:direction,
    jambLeft:{x:axis==='x'?-direction*0.2:0.43,y:base+1.55,z:axis==='x'?0.43:-direction*0.2},
    jambRight:{x:axis==='x'?-direction*0.2:-0.43,y:base+1.55,z:axis==='x'?-0.43:-direction*0.2}};
  const lintel=axis==='x'?{x0:-0.15,x1:0.15,z0:-0.7,z1:0.7,y0:base+2.2,y1:base+3.2}:{x0:-0.7,x1:0.7,z0:-0.15,z1:0.15,y0:base+2.2,y1:base+3.2};
  const walls=axis==='x'?[{x0:-0.15,x1:0.15,z0:0.535,z1:1.5,y0:base,y1:base+3.2},{x0:-0.15,x1:0.15,z0:-1.5,z1:-0.535,y0:base,y1:base+3.2}]:[{x0:0.535,x1:1.5,z0:-0.15,z1:0.15,y0:base,y1:base+3.2},{x0:-1.5,x1:-0.535,z0:-0.15,z1:0.15,y0:base,y1:base+3.2}];
  state.clearance={duck:1,ceilingY:base+2.2,door,obstacles:[lintel,...walls]};
  let maxTop=-Infinity,maxPenetration=0,braced=0;
  for(let f=0;f<clips.walk.frames;f+=8) {
    sample('walk',f);state.phase=f/clips.walk.frames;
    state.contacts.left=clips.walk.contacts?.left?.[f]??0;state.contacts.right=clips.walk.contacts?.right?.[f]??0;
    rig.update(8/data.fps,f/data.fps,state);floor(8/data.fps);assertFinite();
    const dense=exactBounds(/^(Head|Neck|Spine|Hips)/),probe=rig.skinBounds(/^(Head|Neck|Spine|Hips)/);
    maxSkinError=Math.max(maxSkinError,Math.abs(dense.max.y-probe.max.y));
    maxTop=Math.max(maxTop,dense.max.y-base);maxPenetration=Math.max(maxPenetration,rig.motion.metrics.worldPenetration);braced+=rig.motion.metrics.braced;
  }
  doorwaySamples.push({axis,direction,base,top:+maxTop.toFixed(4),penetration:+maxPenetration.toFixed(4),braced});
  assert.ok(maxTop<=2.17,`actual weighted skull/neck/chest fit2.2m ${axis}/${direction}/${base}, top${maxTop}`);
  assert.ok(maxPenetration<0.006,`actual skin probes wall/lintel penetration${maxPenetration}`);
  assert.ok(braced>0,'accessible frame hands really brace');
}

const realDoors=[];
let denseWorst;
for(const axis of ['h','v'])for(const side of [-1,1])for(const level of [0,-1]) {
  const {grid,door}=doorFixture(axis,level);door.open=1;door.dir=axis==='h'?side:-side;
  rig.resetMotion();state.clip='walk';state.floorY=door.base;root.rotation.y=axis==='h'?(side<0?0:Math.PI):(side<0?Math.PI/2:-Math.PI/2);
  const out={};let maxProbePen=0,maxDensePen=0,braceCount=0,maxTop=0;
  for(let f=0;f<clips.walk.frames;f+=4) {
    const distance=0.7-f/clips.walk.frames*1.4;
    root.position.set(door.cx+(axis==='v'?side*distance:0),door.base,door.cz+(axis==='h'?side*distance:0));
    sample('walk',f);state.phase=f/clips.walk.frames;
    state.contacts.left=clips.walk.contacts?.left?.[f]??0;state.contacts.right=clips.walk.contacts?.right?.[f]??0;
    state.clearance=sampleCreatureClearance(grid,root.position.x,root.position.z,root.rotation.y,door.base,1,4/30,out);
    applyDoorLayer(f,state.clearance.duck);
    rig.update(4/30,f/data.fps,state);floor(4/30);assertFinite();
    if(f===0)for(const s of rig.skinSamples){const a=rig.sampleSkinWorld(s,new THREE.Vector3()),b=s.mesh.getVertexPosition(s.index,new THREE.Vector3()).applyMatrix4(s.mesh.matrixWorld);maxCachedError=Math.max(maxCachedError,a.distanceTo(b));}
    maxTop=Math.max(maxTop,exactBounds(/^(Head|Neck|Spine|Hips)/).max.y-door.base);
    for(const s of rig.skinSamples){s.mesh.getVertexPosition(s.index,rig._v[0]);s.mesh.localToWorld(rig._v[0]);maxProbePen=Math.max(maxProbePen,pointObstaclePenetration(rig._v[0],0,state.clearance.obstacles));}
    maxDensePen=Math.max(maxDensePen,exactPenetration(state.clearance.obstacles));
    braceCount+=rig.motion.metrics.braced;
  }
  const row={axis,side,level,headTop:maxTop,probePen:maxProbePen,densePen:maxDensePen,braces:braceCount};realDoors.push(row);
  assert.ok(maxTop<2.17,'realGrid doorway dense upperbody fitslintel');
  assert.ok(maxProbePen<0.006&&maxDensePen<0.006,`realGrid fullskin penetration${JSON.stringify(row)} worst${JSON.stringify(denseWorst)}`);
  assert.ok(braceCount>0,'real accessible jambs contacted');
}

// Open long digits remain expressive across action, shield and doorway layers.
state.clearance=null;state.floorY=0;root.position.set(0,0,0);root.rotation.y=0;sample('attack',Math.floor(clips.attack.frames*0.3));state.clip='attack';state.phase=0.3;
rig.update(1,0.7,state);const attackCurl=rig._curl;state.shield=1;rig.update(1,0.7,state);assert.ok(rig._curl<0.04&&attackCurl>0.25);
state.shield=0;state.clip='walk';sample('walk',12);rig.update(1,0.4,state);
const stable=Object.fromEntries(Object.entries(rig.bones).map(([n,b])=>[n,b.quaternion.clone()]));
for(let i=0;i<20;i++)rig.update(0,0.4,state);
for(const [n,q] of Object.entries(stable))assert.ok(q.angleTo(rig.bones[n].quaternion)<1e-6,`no accumulating${n}`);
for(const rec of bindHashes) {assert.equal(geometryHash(rec.mesh.geometry),rec.geometry);assert.deepEqual(rec.mesh.skeleton.boneInverses.map(m=>m.toArray()),rec.inverse);assert.deepEqual(rec.mesh.skeleton.bones.map(b=>b.uuid),rec.order);assert.deepEqual(rec.mesh.bindMatrix.toArray(),rec.matrix);}
for(const [n,b] of rig.bind)if(n!=='Hips')assert.ok(rig.bones[n].position.distanceTo(b.position)<1e-8,'longbone offsets unchanged');
const started=performance.now();for(let f=0;f<120;f++){sample('walk',f%clips.walk.frames);rig.update(1/30,f/30,state);}const milliseconds=(performance.now()-started)/120;
assert.ok(milliseconds<40,`bounded runtime pose cost${milliseconds.toFixed(2)}ms`);
const {grid:costGrid,door:costDoor}=doorFixture('h',0);costDoor.open=1;costDoor.dir=-1;
root.position.set(costDoor.cx,0,costDoor.cz);root.rotation.y=0;state.clearance=sampleCreatureClearance(costGrid,costDoor.cx,costDoor.cz,0,0,1,1/30,{});
const doorStarted=performance.now();for(let f=0;f<30;f++){sample('walk',f%clips.walk.frames);applyDoorLayer(f,state.clearance.duck);rig.update(1/30,f/30,state);floor(1/30);}const doorMilliseconds=(performance.now()-doorStarted)/30;
assert.ok(doorMilliseconds<55,`bounded full doorway pose cost${doorMilliseconds.toFixed(2)}ms`);
assert.ok(minSelf>=-0.006,'bounded forearm clearance fromactual measured torso/leg capsules');
assert.ok(maxSkinError<0.015,'probe top agreeswithindependent dense skin');
assert.ok(maxCachedError<1e-8,'fast probeLBS equals independent original meshgetVertexPosition');
assert.ok(maxSoleError<0.05,'actual weighted skinsole support');
const liveModel=new CreatureModel(structuredClone(data),null,null,asset);let minPublicSole=Infinity;
for(const base of [0,-2.6])for(const name of ['walk','run','creep']) {
  liveModel.group.position.set(0,base,0);liveModel.mixer.stopAllAction();liveModel.current=null;liveModel.groundOffset=0;liveModel.play(name,0,{restart:true});
  for(let f=0;f<30;f++) {
    liveModel.group.position.z+=liveModel.clipSpeed(name)/30;liveModel.update(1/30,base,f/30);
    for(const side of ['Left','Right'])minPublicSole=Math.min(minPublicSole,liveModel.guardian.motion.soleY(side)-base);
  }
}
assert.ok(minPublicSole>=-0.006,`public damped floor cannot bury a released foot${minPublicSole}`);
const fastCourses=[];
for(const axis of ['h','v'])for(const direction of [-1,1])for(const level of [0,-1]) {
  const {grid:g,door:d}=doorFixture(axis,level);d.setOpen(true,d.cx-(axis==='v'?direction:0),d.cz-(axis==='h'?direction:0),true);d.open=1;
  liveModel.setEnvironment(g);liveModel.group.rotation.y=axis==='h'?(direction===1?0:Math.PI):(direction===1?Math.PI/2:-Math.PI/2);
  liveModel.group.position.set(d.cx,d.base,d.cz);liveModel.mixer.stopAllAction();liveModel.current=null;liveModel.groundOffset=0;liveModel.play('run',0,{restart:true});liveModel.actions.run.setEffectiveTimeScale(4.25/liveModel.clipSpeed('run'));
  let braces=0,penetration=0;
  for(let f=0;f<=Math.ceil(4.8*30/4.25);f++) {
    const normal=-2.4+f*4.25/30;liveModel.group.position.set(d.cx+(axis==='v'?direction*normal:0),d.base,d.cz+(axis==='h'?direction*normal:0));liveModel.update(1/30,d.base,f/30);
    if(Math.abs(normal)<0.55)braces+=liveModel.guardian.motion.metrics.braced;
    for(const s of liveModel.guardian.skinSamples){const p=s.mesh.getVertexPosition(s.index,new THREE.Vector3()).applyMatrix4(s.mesh.matrixWorld);penetration=Math.max(penetration,pointObstaclePenetration(p,0,liveModel.clearance.obstacles));}
  }
  fastCourses.push({axis,direction,level,braces,penetration});
  assert.ok(braces>0,'physically reachable final run brace');assert.ok(penetration<0.006,'fast run whole skin clears real doors');
}
// AI paths can approach either side of the centerline. Both lateral offsets
// exercise the asymmetric shoulders and the actual open leaf beside the jamb.
const offsetCourses=[];
for(const offset of [-0.12,0.12])for(const axis of ['h','v'])for(const direction of [-1,1])for(const level of [0,-1]) {
  const {grid:g,door:d}=doorFixture(axis,level);d.setOpen(true,d.cx-(axis==='v'?direction:0),d.cz-(axis==='h'?direction:0),true);d.open=1;
  liveModel.setEnvironment(g);liveModel.group.rotation.y=axis==='h'?(direction===1?0:Math.PI):(direction===1?Math.PI/2:-Math.PI/2);
  liveModel.group.position.set(d.cx,d.base,d.cz);liveModel.mixer.stopAllAction();liveModel.current=null;liveModel.groundOffset=0;liveModel.play('walk',0,{restart:true});
  const speed=1.25;liveModel.actions.walk.setEffectiveTimeScale(speed/liveModel.clipSpeed('walk'));
  let braces=0,penetration=0,top=0,sole=Infinity,denseControls=0,worst;
  const p=new THREE.Vector3();
  function measurePoint(point,index,bone,dense=false) {const depth=pointObstaclePenetration(point,0,liveModel.clearance.obstacles);if(depth>penetration){penetration=depth;worst={index,bone,dense,point:point.toArray(),phase:liveModel.guardianState.phase,duck:liveModel.clearance.duck};}}
  for(let f=0;f<=Math.ceil(4.8*30/speed);f++) {
    const normal=-2.4+f*speed/30;
    liveModel.group.position.set(d.cx+(axis==='v'?direction*normal:offset),d.base,d.cz+(axis==='h'?direction*normal:offset));liveModel.update(1/30,d.base,f/30);
    for(const side of ['Left','Right'])sole=Math.min(sole,liveModel.guardian.motion.soleY(side)-d.base);
    for(const s of liveModel.guardian.skinSamples){s.mesh.getVertexPosition(s.index,p).applyMatrix4(s.mesh.matrixWorld);measurePoint(p,s.index,s.bone);}
    if(Math.abs(normal)<0.55) {
      braces+=liveModel.guardian.motion.metrics.braced;top=Math.max(top,liveModel.guardian.skinBounds(/^(Head|Neck|Spine|Hips)/).max.y-d.base);
      if(f%12===0||Math.abs(normal)<speed/60) {liveModel.group.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;for(let index=0;index<mesh.geometry.attributes.position.count;index++){mesh.getVertexPosition(index,p).applyMatrix4(mesh.matrixWorld);measurePoint(p,index,null,true);}});denseControls++;}
    }
  }
  const row={offset,axis,direction,level,braces,penetration,top,sole,denseControls};offsetCourses.push(row);
  assert.ok(braces>0,`off-center reachable final brace${JSON.stringify(row)}`);
  assert.ok(penetration<0.006,`off-center actual skin clears doors${JSON.stringify(row)} worst${JSON.stringify(worst)}`);
  assert.ok(top<2.17&&sole>=-0.006,`off-center weighted head/feet${JSON.stringify(row)}`);
}
console.log(JSON.stringify({sha256,profile:rig.profile,strideScale:rig.strideScale,worldStrideScale:rig.motion.worldStrideScale,skinProbes:rig.skinSamples.length,supportProbes:rig.supportSamples.length,samples,moving:{headTravel,footTravel},minSelf,maxSoleError,minPublicSole,maxSkinError,maxCachedError,doorwaySamples,realDoors,fastCourses,offsetCourses,poseMilliseconds:milliseconds,doorMilliseconds,bodyShift:rig.motion.metrics.bodyShift}));
console.log('SKINWALKER_RIG_VERIFIED');

function geometryHash(g){const h=createHash('sha256');for(const [n,a] of Object.entries(g.attributes)){h.update(n);h.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));}if(g.index)h.update(Buffer.from(g.index.array.buffer));return h.digest('hex');}
function decode(b64,s){const bytes=Buffer.from(b64,'base64'),out=[];for(let i=0;i<bytes.length;i+=2)out.push(bytes.readInt16LE(i)/s);return out;}
function sample(n,f){const c=clips[n],J=list.length;source.position.y=0;for(let j=0;j<J;j++){const off=(f*J+j)*4;list[j].quaternion.fromArray(c.rotValues,off).normalize();}const off=f*3;sourceBones.Hips.position.set(c.loop?c.rootValues[off]:0,c.rootValues[off+1],c.loop?c.rootValues[off+2]:0);root.updateMatrixWorld(true);}
function floor(dt){source.position.y=(state.floorY-rig.supportY())/root.scale.y;root.updateMatrixWorld(true);rig.ground(dt,state.floorY,state);}
function assertFinite(){for(const [n,b] of Object.entries(rig.bones))assert.ok(b.quaternion.toArray().every(Number.isFinite)&&b.position.toArray().every(Number.isFinite),`finite${n}`);}
function doorFixture(axis,level){const rows=Array.from({length:11},()=>Array(11).fill('.'));for(let y=0;y<11;y++)for(let x=0;x<11;x++)if(x===0||y===0||x===10||y===10||(axis==='h'?y===5:x===5))rows[y][x]='#';rows[5][5]='D';const grid=new Grid({W:11,H:11,grid:rows,zone:rows.map(r=>r.map(()=>'r')),zones:{r:{level,wall:'clinic',ceil:'tiles'}},objects:[]});const door=new DoorCore(grid,5,5,'D');return{grid,door};}
function applyDoorLayer(f,weight){if(!layerRot)return;const frame=f%layer.frames;for(const name of layer.upperBodyMask??layer.upperBodyBones??[]){const j=data.skeleton.names.indexOf(name);if(j<0)continue;layerQ.fromArray(layerRot,(frame*list.length+j)*4).normalize();list[j].quaternion.slerp(layerQ,weight);}root.updateMatrixWorld(true);}
function exactPenetration(obstacles){let depth=0;const p=new THREE.Vector3();target.updateMatrixWorld(true);target.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,p);mesh.localToWorld(p);const d=pointObstaclePenetration(p,0,obstacles);if(d>depth){depth=d;denseWorst={point:p.toArray(),weights:[0,1,2,3].map(k=>[mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(i,k)].name,mesh.geometry.attributes.skinWeight.getComponent(i,k)]),index:i};}}});return depth;}
