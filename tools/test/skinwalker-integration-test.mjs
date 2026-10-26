import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { CreatureModel } from '../../src/entities/creature.js';
import { CreatureAI } from '../../src/entities/creatureAI.js';
import { AnimData } from '../../src/shared/animdata.js';
import { HeadlessCreatureModel } from '../../server/headless-model.js';
import { NetCreature } from '../../src/net/netcreature.js';
import { CREATURE_STATES,CLIPS } from '../../src/net/protocol.js';
import { pointObstaclePenetration } from '../../src/shared/creature-clearance.js';
import { parseSkinwalkerForInspection } from '../skinwalker-asset-inspect.mjs';
import { doorwayFixture,skinPoints,begin } from './skinwalker-fixture.mjs';

const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const baseline=await json('.unlazy/skinwalker/baseline.json');
for(const [file,expected]of Object.entries(baseline.hashes))assert.equal(hash(await fs.readFile(file)),expected,`${file}: preserved unrelated game`);
assert.throws(()=>assert.equal(hash(Buffer.from('altered')),hash(Buffer.from('original'))));
await import('./skinwalker-navigation-test.mjs');
const data=await json('assets/anim/creature.json'),previous=await json('.unlazy/skinwalker/previous-creature.json');
assert.deepEqual(Object.keys(data.clips).sort(),Object.keys(previous.clips).sort());
assert.deepEqual(data.skeleton,previous.skeleton);
assert.equal(data.guardianMotion.version,2);assert.equal(data.guardianMotion.profile,'skinwalker');
assert.ok(data.guardianMotion.anatomy?.assetSha256,'actual body/headless calibration available');
for(const key of Object.keys(data.clips))assert.notEqual(data.clips[key].rot,previous.clips[key].rot,`${key}: recreated`);
const {asset,sha256}=await parseSkinwalkerForInspection();
assert.equal(sha256,'1d99d6f111cda964c51db3e5241203559cb41b73646338a3e79ceaffa8d446f0');
assert.equal(data.guardianMotion.anatomy.assetSha256,sha256);
assert.equal(data.guardianMotion.anatomy.authoredHeight,3);
for(const [key,c]of Object.entries(data.guardianMotion.anatomy.clips)) {
  assert.ok(data.clips[key]);assert.equal(c.poses.length,3);
  for(const poses of c.poses){assert.equal(poses.length,32);for(const pose of poses){assert.equal(pose.length,6);assert.ok(pose.every(Number.isFinite));}}
}
const model=new CreatureModel(structuredClone(data),null,null,asset),anim=new AnimData(data),server=new HeadlessCreatureModel(anim);
assert.ok(model.skinwalkerMotion);assert.equal(model.guardian.motion.constructor.name,'SkinwalkerMotion');
assert.ok(Math.abs(model.guardianRoot.userData.guardianAsset.height*1.3-3)<1e-6);
assert.ok(Math.abs(model.strideScale-model.guardian.motion.worldStrideScale)<1e-6,'speed uses real world leg ratio');
assert.ok(model.doorwayTracks.length>=14);assert.ok(model.doorwayTracks.every(t=>!/(Hips|Leg|Shin|Foot|Toe)/.test(t.bone.name)));
for(const key of Object.keys(data.clips)) {
  assert.ok(CLIPS.includes(key));assert.equal(model.clipSpeed(key),server.clipSpeed(key));
  assert.ok(Math.abs(model.duration(key)-server.duration(key))<1e-6);
  for(const t of [0,.4,model.duration(key)*.6,model.duration(key)])assert.deepEqual(model.rootAt(key,t),server.rootAt(key,t));
  if(!data.clips[key].loop)assert.equal(data.clips[key].frames,previous.clips[key].frames,'same gameplay window');
}
const indices=Array.from({length:80},(_,i)=>Math.floor(i*37523/79));
const movement={},gait={};
for(const key of Object.keys(data.clips).filter(k=>k!=='pain')) {
  begin(model,key);model.update(1/30,0,0);
  const before=skinPoints(model,indices),fingers=model.guardian.fingers.map(f=>f.bone.quaternion.clone());
  for(let i=0;i<30;i++)model.update(1/30,0,i/30);
  const after=skinPoints(model,indices),delta=Math.max(...after.map((p,i)=>p.distanceTo(before[i])));
  assert.ok(delta>.006,`${key}: actual skin pose changes`);movement[key]=+delta.toFixed(4);
  assert.ok(model.guardian.fingers.some((f,i)=>f.bone.quaternion.angleTo(fingers[i])>.002),`${key}: long fingers move`);
  assert.ok(Math.abs(model.guardian.supportY())<.08,`${key}: floor support`);
  assert.ok(model.headWorld().distanceTo(model.chestWorld())>.12);
}
for(const key of ['walk','run','creep','stalk','limp']) {
  model.group.position.set(4,-2.6,8);model.group.rotation.y=.7;begin(model,key);
  let contactFrames=0,maxSlip=0,legTravel=0,previousQ;
  for(let f=0;f<Math.ceil(model.duration(key)*120);f++) {
    const step=model.clipSpeed(key)/60;model.group.position.x+=Math.sin(.7)*step;model.group.position.z+=Math.cos(.7)*step;
    const root=model.group.position.clone();model.update(1/60,-2.6,f/60);
    assert.deepEqual(model.group.position.toArray(),root.toArray(),'IK preserves authoritative root');
    const q=model.bones.LeftLeg.quaternion;if(previousQ)legTravel+=q.angleTo(previousQ);previousQ=q.clone();
    for(const side of ['Left','Right']) {const foot=model.guardian.motion.feet[side];if(foot.active&&foot.weight>.99){contactFrames++;maxSlip=Math.max(maxSlip,foot.slip);}}
  }
  assert.ok(legTravel>.4,'moving source legs never static');assert.ok(contactFrames>8,'both feet have meaningful contact');
  assert.ok(maxSlip<.02,`${key}: world sole slipping ${maxSlip}`);gait[key]={legTravel,contactFrames,maxSlip};
}

// The real Grid/DoorCore sampler feeds the complete native upper-body layer and
// public update, including post-floor IK. Test both sides/axes and basement.
const passages=[];let denseControls=0;
for(const locomotion of ['creep','walk','run'])for(const axis of ['h','v'])for(const direction of [-1,1])for(const level of [0,-1]) {
  const {g,d}=doorwayFixture(axis,level);d.setOpen(true,d.cx-(axis==='v'?direction:0),d.cz-(axis==='h'?direction:0),true);d.open=1;
  model.setEnvironment(g);model.group.rotation.y=axis==='h'?(direction===1?0:Math.PI):(direction===1?Math.PI/2:-Math.PI/2);
  model.group.position.set(d.cx,d.base,d.cz);begin(model,locomotion);
  const speed=locomotion==='run'?4.25:locomotion==='walk'?1.25:1;
  model.actions[locomotion].setEffectiveTimeScale(speed/model.clipSpeed(locomotion));
  let maxPen=0,maxTop=0,braced=0,legTravel=0,previousQ,worst;
  for(let f=0;f<=Math.ceil(4.8*30/speed);f++) {
    const normal=-2.4+f*speed/30;
    model.group.position.set(d.cx+(axis==='v'?direction*normal:0),d.base,d.cz+(axis==='h'?direction*normal:0));
    model.update(1/30,d.base,f/30);
    const q=model.bones.LeftLeg.quaternion;if(previousQ)legTravel+=q.angleTo(previousQ);previousQ=q.clone();
    for(const s of model.guardian.skinSamples){const p=s.mesh.getVertexPosition(s.index,new THREE.Vector3()).applyMatrix4(s.mesh.matrixWorld),pen=pointObstaclePenetration(p,0,model.clearance.obstacles);if(pen>maxPen){maxPen=pen;worst={f,normal,bone:s.bone,index:s.index,point:p.toArray(),phase:model.guardianState.phase,duck:model.clearance.duck,metrics:{...model.guardian.motion.metrics}};}}
    if(Math.abs(normal)<.55) {
      maxTop=Math.max(maxTop,model.guardian.motion.metrics.headTopY-d.base);braced+=model.guardian.motion.metrics.braced;
      if(f%12===0||Math.abs(normal)<speed/60){const dense=skinPoints(model);for(let index=0;index<dense.length;index++){const p=dense[index],pen=pointObstaclePenetration(p,0,model.clearance.obstacles);if(pen>maxPen){maxPen=pen;worst={f,normal,dense:true,index,point:p.toArray(),phase:model.guardianState.phase,duck:model.clearance.duck,metrics:{...model.guardian.motion.metrics}};}}denseControls++;}
    }
    assert.ok(model.actions[locomotion].enabled&&model.actions[locomotion].isScheduled(),'duck preserves active locomotion');
    assert.ok(Math.abs(model.guardian.supportY()-d.base)<.08,`sole ${locomotion}/${axis}/${direction}/${level} f${f} normal${normal} support${model.guardian.supportY()-d.base} ${JSON.stringify(model.guardian.motion.metrics)}`);
  }
  passages.push({locomotion,axis,direction,level,maxPen,maxTop,braced,legTravel,worst});console.log(JSON.stringify(passages.at(-1)));
  assert.ok(maxTop<2.195,'actual weighted skull below real lintel');
  assert.ok(maxPen<.006,`skin including long nails intersects real door/wall ${maxPen}`);
  assert.ok(braced>0,'actual accessible hands brace frame');assert.ok(legTravel>.5,'ducking does not stop gait');
}
model.setEnvironment(null);model.group.position.set(0,0,0);model.group.rotation.y=0;begin(model,'idle');
const ai=new CreatureAI({grid:doorwayFixture().g},model);ai.state='chase';ai.stateT=2;
model.setEnvironment(null);
model.afterPose=null;
for(let f=0;f<180;f++){ai.pos.z+=4/60;model.group.position.copy(ai.pos);ai.animate(1/60);model.update(1/60,0,f/60);if(f>30){assert.equal(model.current,'run');assert.ok(model.actions.run.time>=0&&model.actions.run.enabled);}}
model.mixer.stopAllAction();model.update(1/60,0,4);model.update(1/60,0,4.1);assert.ok(model.actions.run.isScheduled(),'stopped moving action repaired');
model.setShield(.9);model.update(1/30,0,5);assert.ok(model.actions.shield.isRunning());model.setShield(0);assert.ok(model.flinch());assert.equal(model.flinch(),false);
for(let f=0;f<30;f++)model.update(1/30,0,5+f/30);assert.equal(model.painT,-1);
const net=new NetCreature({grid:{},world:{vents:[]},player:{pos:new THREE.Vector3()}},model);
net.onSnap({s:CREATURE_STATES.indexOf('chase'),u:-1,t:1,en:0,bn:0,sp:4,v:1,x:4,y:0,z:8,yw:.5,cl:CLIPS.indexOf('run'),ps:1,ts:1.1,lk:null,lw:0,bg:0,es:0,sh:0},performance.now()/1000);
net.update(1/30);model.update(1/30,0,6);assert.equal(model.current,'run');assert.equal(model.group.visible,true);net.reset();assert.equal(model.group.visible,false);
const result={unchangedFiles:Object.keys(baseline.hashes).length,actions:13,movement,gait,passages,denseControls};
await fs.writeFile('.unlazy/skinwalker/integration-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
console.log('SKINWALKER_INTEGRATION_VERIFIED');
