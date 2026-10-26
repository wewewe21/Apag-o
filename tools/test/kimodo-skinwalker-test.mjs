import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Quaternion,Vector3} from 'three';

// Independent Node/Three FK oracle. The Python packer is never imported.
const root=path.resolve(import.meta.dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p));
const json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,''));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const prior=json('tools/kimodo_skinwalker/gameplay-envelope.json');
const data=json('assets/anim/creature.json');
const review=json('tools/kimodo_skinwalker/candidate-review.json');
const names=['attack','crawl','creep','idle','inspect','limp','look','pain','recoil','roar','run','stalk','walk'];
const locomotion=['walk','run','creep','stalk','limp','crawl','doorway'];
function i16(b64,scale){const b=Buffer.from(b64,'base64');assert.equal(b.length%2,0);return Array.from({length:b.length/2},(_,i)=>b.readInt16LE(i*2)/scale);}
function floats(b){assert.equal(b.length%4,0);return Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));}
function quat(v,index){return new Quaternion().fromArray(v,index*4).normalize();}
function validateQuat(values){assert.equal(values.length%4,0);for(let i=0;i<values.length;i+=4){const q=values.slice(i,i+4);assert.ok(q.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...q)-1)<.00008,`unit quaternion ${i/4}`);}}
function fkFrame(rot,roots,frame,sk){
  const points=[],qs=[];
  for(let j=0;j<sk.names.length;j++){
    const parent=sk.parents[j],q=quat(rot,frame*sk.names.length+j);
    if(parent<0){points.push(new Vector3().fromArray(roots,frame*3));qs.push(q);}
    else{points.push(new Vector3().fromArray(sk.offsets[j]).applyQuaternion(qs[parent]).add(points[parent]));qs.push(qs[parent].clone().multiply(q));}
  }
  return {points,qs};
}
function percentile(values,p){const a=values.toSorted((a,b)=>a-b),at=(a.length-1)*p/100,lo=Math.floor(at),hi=Math.ceil(at);return a[lo]*(1-(at-lo))+a[hi]*(at-lo);}
function measuredContacts(rot,positions,clip){
  const anchors={left:[],right:[]};
  for(let f=0;f<clip.frames;f++){
    const {points:p,qs}=fkFrame(rot,positions,f,data.skeleton);
    for(const [side,foot,toe] of [['left',24,25],['right',28,29]]){
      const heel=new Vector3(0,-.05,-.045).applyQuaternion(qs[foot]).add(p[foot]);
      const row=[p[foot].clone(),p[toe].clone(),heel];for(const a of row)a.z+=f*clip.speed/30;anchors[side].push(row);
    }
  }
  const result={};
  for(const side of ['left','right']){
    const a=anchors[side],floor=[0,1,2].map(j=>percentile(a.map(row=>row[j].y),5));
    const velocity=a.map((row,f)=>row.map((_,j)=>{const lo=Math.max(f-1,0),hi=Math.min(f+1,clip.frames-1),delta=a[hi][j].clone().sub(a[lo][j]);return Math.hypot(delta.x,delta.z)*30/(hi-lo);}));
    const threshold=Math.max(.30,percentile(velocity.map(v=>Math.min(...v)),30)*1.6);
    const values=a.map((row,f)=>Math.max(...row.map((anchor,j)=>Math.max(0,Math.min(1,1-(anchor.y-floor[j]-.012)/.075))*Math.max(0,Math.min(1,1-(velocity[f][j]-.18)/Math.max(.50,threshold))))));
    result[side]=values.map((v,f)=>(values[(f+values.length-1)%values.length]+2*v+values[(f+1)%values.length])/4);
  }
  return result;
}
function sourceStreams(source){
  assert.ok(source.rawDirectory.startsWith('tools/kimodo_skinwalker/raw/'));
  const manifest=json(source.generationManifest),rootBytes=read(`${source.rawDirectory}/root_positions.f32`),rotBytes=read(`${source.rawDirectory}/local_rotations_xyzw.f32`);
  assert.equal(sha(rootBytes),source.rawSha256['root_positions.f32']);assert.equal(sha(rotBytes),source.rawSha256['local_rotations_xyzw.f32']);
  assert.deepEqual(manifest.streams,source.rawSha256);assert.equal(manifest.steps,100);assert.equal(source.steps,100);assert.equal(manifest.joints,30);assert.equal(manifest.seed,source.seed);assert.equal(manifest.frames,source.rawFrames);assert.equal(manifest.profile,'skinwalker');
  assert.equal(read(source.promptFile).toString(),manifest.prompt);assert.equal(manifest.backend,'vulkan');assert.equal(manifest.textLayerChunk,32);assert.equal(manifest.textResidentLimitMiB,9000);assert.equal(manifest.motionLayerChunk,8);
  assert.equal(manifest.models.motionModel.sha256,data.guardianMotion.model.sha256);assert.equal(manifest.models.textModel.sha256,data.guardianMotion.textModel.sha256);
  assert.ok(manifest.elapsedSeconds>0&&manifest.elapsedSeconds<300);assert.ok(manifest.protocol.includes(`\t${source.seed}\t`));assert.ok(manifest.models.executable.path.endsWith('kmd-generate.exe'));
  const rawRoot=floats(rootBytes),rawRot=floats(rotBytes);assert.equal(rawRoot.length,manifest.frames*3);assert.equal(rawRot.length,manifest.frames*120);assert.ok(rawRoot.every(Number.isFinite)&&rawRot.every(Number.isFinite));validateQuat(rawRot);
  return {manifest,rawRoot,rawRot,rotBytes};
}
function validateClip(name,clip){
  const source=clip.sourceMotion,{manifest,rawRoot,rawRot,rotBytes}=sourceStreams(source);
  assert.equal(manifest.name,name);assert.equal(review.selected[name],clip.src);
  const rot=i16(clip.rot,32767),positions=i16(clip.root,1000);assert.equal(rot.length,clip.frames*120);assert.equal(positions.length,clip.frames*3);validateQuat(rot);assert.ok(positions.every(Number.isFinite));
  if(prior.clips[name])assert.notEqual(sha(clip.rot),prior.clips[name].rotationSha256,`${name}: new body performance`);
  const turn=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-source.alignmentYaw),tests=clip.loop?Math.floor(clip.frames*.65):clip.frames;
  for(let f=0;f<tests;f++){
    const at=source.range?source.range[0]+f:clip.loop?f:f/(clip.frames-1)*(source.rawFrames-1),lo=Math.floor(at),hi=Math.min(source.rawFrames-1,lo+1),t=at-lo;
    for(let j=0;j<30;j++){
      const expected=quat(rawRot,lo*30+j).slerp(quat(rawRot,hi*30+j),t);if(j===0)expected.premultiply(turn);
      assert.ok(expected.angleTo(quat(rot,f*30+j))<.0002,`${name}: native quaternion ${f}/${j}`);
    }
    const y=rawRoot[lo*3+1]*(1-t)+rawRoot[hi*3+1]*t;assert.ok(Math.abs(positions[f*3+1]-y)<=.00051,`${name}: fresh native hipY`);
  }
  if(clip.loop){
    for(let j=0;j<30;j++)assert.ok(quat(rot,j).angleTo(quat(rot,(clip.frames-1)*30+j))<.0002,`${name}: closed rotation seam`);
    assert.ok(new Vector3().fromArray(positions).distanceTo(new Vector3().fromArray(positions,(clip.frames-1)*3))<.00001,`${name}: closed root seam`);
  }else{
    const old=i16(prior.clips[name].root,1000);assert.equal(clip.frames,prior.clips[name].frames);
    for(let f=0;f<clip.frames;f++)for(const axis of [0,2])assert.equal(positions[f*3+axis],old[f*3+axis],`${name}: previous gameplay XZ`);
  }
  const summary={seed:source.seed,frames:clip.frames,rawHash:sha(rotBytes)};
  if(locomotion.includes(name)){
    assert.ok(clip.frames>=(name==='run'?36:54));assert.ok(clip.speed>=.12&&clip.speed<7);
    const [first,last]=source.range,speed=Math.hypot(rawRoot[last*3]-rawRoot[first*3],rawRoot[last*3+2]-rawRoot[first*3+2])/((last-first)/30);assert.ok(Math.abs(speed-clip.speed)<.000051,`${name}: true native speed`);
    const differential=[],left=[],right=[],ly=[],ry=[],hunch=[],asymmetry=[],handSpan=[];
    for(let f=first;f<last;f++){
      const {points:p}=fkFrame(rawRot,rawRoot,f,data.skeleton),l=p[24].clone().sub(p[0]).applyQuaternion(turn),r=p[28].clone().sub(p[0]).applyQuaternion(turn),spine=p[6].clone().sub(p[0]).applyQuaternion(turn);
      left.push(l.z);right.push(r.z);differential.push(l.z-r.z);ly.push(p[24].y);ry.push(p[28].y);hunch.push(Math.atan2(Math.abs(spine.z),Math.max(.01,spine.y))*180/Math.PI);asymmetry.push(Math.abs(p[11].y-p[17].y));handSpan.push(p[13].distanceTo(p[19]));
    }
    let switches=0,leading=0;for(const value of differential){const next=value>.025?1:value<-.025?-1:leading;if(leading&&next!==leading)switches++;leading=next;}
    assert.ok(switches>=2,`${name}: complete alternating both-leg cycle`);
    assert.ok(Math.max(...left)-Math.min(...left)>.035&&Math.max(...right)-Math.min(...right)>.035);assert.ok(Math.max(...ly)-Math.min(...ly)>.015&&Math.max(...ry)-Math.min(...ry)>.015);
    const measured=measuredContacts(rot,positions,clip);
    for(const side of ['left','right']){
      assert.equal(clip.contacts[side].length,clip.frames);assert.ok(clip.contacts[side].every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(Math.max(...clip.contacts[side])>.4);assert.ok(Math.min(...clip.contacts[side])<.3);
      for(let f=0;f<clip.frames;f++)assert.ok(Math.abs(measured[side][f]-clip.contacts[side][f])<.000051,`${name}: independent final-pose FK contact ${side}/${f}`);
    }
    const unsupported=clip.contacts.left.filter((v,i)=>Math.max(v,clip.contacts.right[i])<.2).length/clip.frames;
    // Running can include flight. Crawling transfers support onto hands.
    if(['walk','stalk','limp','doorway'].includes(name))assert.ok(unsupported<.15,`${name}: grounded support ${unsupported}`);
    const choices=review.candidates[name].filter(c=>!c.rejected),chosen=choices.find(c=>c.seed===source.seed);assert.ok(chosen&&choices.every(c=>chosen.best.score<=c.best.score+1e-10));
    const meanHunch=hunch.reduce((a,b)=>a+b)/hunch.length;assert.ok(Math.abs(meanHunch-chosen.best.performance.meanHunchDegrees)<1e-5);
    if(name==='run')assert.ok(meanHunch>=25,'Running keeps a genuine source hunch');
    if(name==='doorway'){assert.ok(meanHunch>=45&&Math.min(...hunch)>=25,'Doorway stays ducked for the entire selected native cycle');assert.ok(handSpan.reduce((a,b)=>a+b)/handSpan.length>=.40,'Doorway keeps hands off the body ready for world-space bracing');}
    Object.assign(summary,{speed:clip.speed,leadingFootSwitches:switches,meanHunchDegrees:+meanHunch.toFixed(2),shoulderAsymmetry:+(asymmetry.reduce((a,b)=>a+b)/asymmetry.length).toFixed(4),unsupportedFraction:+unsupported.toFixed(3)});
  }
  return summary;
}

assert.equal(data.guardianMotion.version,2);assert.equal(data.guardianMotion.profile,'skinwalker');assert.equal(data.fps,30);assert.deepEqual(Object.keys(data.clips).sort(),names);assert.deepEqual(data.skeleton,prior.skeleton);assert.equal(data.skeleton.names.length,30);assert.equal(data.guardianMotion.originalPackSha256,prior.previousPackSha256);
const sourceLegMean=['Left','Right'].map(side=>['Shin','Foot'].reduce((sum,part)=>sum+Math.hypot(...data.skeleton.offsets[data.skeleton.names.indexOf(side+part)]),0)).reduce((a,b)=>a+b)/2;
assert.ok(Math.abs(sourceLegMean-data.guardianMotion.strideMeasurement.nativeMeanLegLength)<1e-8);
assert.ok(Math.abs(data.guardianMotion.strideScale*sourceLegMean-data.guardianMotion.strideMeasurement.worldTargetLegLength)<1e-6,'Measured3m target/native stride');
const all={...data.clips,doorway:data.guardianMotion.visualLayers.doorway};
assert.equal(all.doorway.visualOnly,true);assert.equal(all.doorway.blendParameter,'clearance.duck');assert.equal(all.doorway.phaseParameter,'locomotion.phase');assert.equal(all.doorway.fps,30);
assert.deepEqual(all.doorway.upperBodyMask,all.doorway.upperBodyBones);
assert.deepEqual(all.doorway.upperBodyBoneIndices,all.doorway.upperBodyBones.map(n=>data.skeleton.names.indexOf(n)));
assert.ok(all.doorway.upperBodyBones.includes('Chest')&&all.doorway.upperBodyBones.includes('LeftHand')&&all.doorway.upperBodyBones.includes('RightHand'));
assert.ok(all.doorway.upperBodyBones.every(n=>!['Hips','LeftLeg','LeftShin','LeftFoot','LeftToeBase','RightLeg','RightShin','RightFoot','RightToeBase'].includes(n)));
const summary=Object.fromEntries(Object.entries(all).map(([name,clip])=>[name,validateClip(name,clip)]));assert.equal(new Set(Object.values(summary).map(v=>v.rawHash)).size,14);
for(const name of locomotion)assert.ok(review.candidates[name].length>=(['walk','run'].includes(name)?3:2),`${name}: enough fresh compared candidates`);
const rawHashes=new Set();for(const candidates of Object.values(review.candidates))for(const candidate of candidates){
  const m=json(`${candidate.rawDirectory}/generation.json`);assert.equal(m.profile,'skinwalker');assert.equal(m.steps,100);
  for(const [file,expected] of Object.entries(m.streams))assert.equal(sha(read(`${candidate.rawDirectory}/${file}`)),expected);
  const hash=m.streams['local_rotations_xyzw.f32'];assert.ok(!rawHashes.has(hash));rawHashes.add(hash);
}
assert.ok(rawHashes.size>=23);
// Mutate the accepted final pack and require the whole oracle to reject each
// defect, not just an assertion helper disconnected from the production data.
let negativeControls=0;
function rejects(mutate){const bad=structuredClone(data.clips.walk);mutate(bad);assert.throws(()=>validateClip('walk',bad));negativeControls++;}
rejects(c=>{const b=Buffer.from(c.rot,'base64');for(let k=0;k<8;k++)b[k]=0;c.rot=b.toString('base64');});
rejects(c=>{const b=Buffer.from(c.rot,'base64');b.writeInt16LE(20000,(c.frames-1)*120*2);c.rot=b.toString('base64');});
rejects(c=>{c.contacts.left.fill(1);});
rejects(c=>{c.speed=0;});
rejects(c=>{c.sourceMotion.rawSha256['root_positions.f32']='0'.repeat(64);});
rejects(c=>{c.frames--;});
assert.equal(negativeControls,6);
const nativePayloadSha256=sha(JSON.stringify({fps:data.fps,skeleton:data.skeleton,clips:data.clips,doorway:data.guardianMotion.visualLayers.doorway}));
console.log(JSON.stringify({summary,comparedRawStreams:rawHashes.size,corruptionControlsRejected:negativeControls,nativePayloadSha256,packSha256:sha(read('assets/anim/creature.json'))}));
console.log('KIMODO_SKINWALKER_VERIFIED');
