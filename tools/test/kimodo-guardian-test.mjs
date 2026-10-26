import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Quaternion, Vector3 } from 'three';

const root=path.resolve(import.meta.dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p));
const json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,''));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const original=json('.unlazy/guardian-motion/original-creature.json');
const data=json('assets/anim/creature.json');
const review=json('tools/kimodo_guardiao/candidate-review.json');
const names=['attack','crawl','creep','idle','inspect','limp','look','pain','recoil','roar','run','stalk','walk'];
const locomotion=['walk','run','creep','stalk','limp','crawl'];
// Buffer offsets are independent on each allocation. Read through DataView so
// this acceptance script is portable across pooled and unpooled Node buffers.
function i16(b64,scale){const b=Buffer.from(b64,'base64');const v=[];for(let i=0;i<b.length;i+=2)v.push(b.readInt16LE(i)/scale);return v;}
function floats(buffer){const v=[];for(let i=0;i<buffer.length;i+=4)v.push(buffer.readFloatLE(i));return v;}
function validateQuat(values){assert.equal(values.length%4,0);for(let i=0;i<values.length;i+=4){const q=values.slice(i,i+4);assert.ok(q.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...q)-1)<.00008,`unit quaternion ${i/4}`);}}
function validateContacts(values,n){assert.equal(values.length,n);assert.ok(values.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(Math.max(...values)>.4);assert.ok(Math.min(...values)<.3);}
function quat(v,index){return new Quaternion().fromArray(v,index*4).normalize();}
function fkFrame(rot,roots,frame,sk,withRotations=false){
  const points=[],qs=[];
  for(let j=0;j<sk.names.length;j++){
    const parent=sk.parents[j],q=quat(rot,frame*sk.names.length+j);
    if(parent<0){points.push(new Vector3().fromArray(roots,frame*3));qs.push(q);}
    else{points.push(new Vector3().fromArray(sk.offsets[j]).applyQuaternion(qs[parent]).add(points[parent]));qs.push(qs[parent].clone().multiply(q));}
  }
  return withRotations?{points,qs}:points;
}
function percentile(values,percent){const a=values.toSorted((a,b)=>a-b),at=(a.length-1)*percent/100,lo=Math.floor(at),hi=Math.ceil(at);return a[lo]*(1-(at-lo))+a[hi]*(at-lo);}
function independentContacts(rot,positions,clip){
  const anchors={left:[],right:[]};
  for(let f=0;f<clip.frames;f++){
    const {points:p,qs}=fkFrame(rot,positions,f,data.skeleton,true);
    for(const [side,foot,toe] of [['left',24,25],['right',28,29]]){
      const heel=new Vector3(0,-.05,-.045).applyQuaternion(qs[foot]).add(p[foot]);
      const row=[p[foot].clone(),p[toe].clone(),heel];
      for(const a of row)a.z+=f*clip.speed/30;
      anchors[side].push(row);
    }
  }
  const result={};
  for(const side of ['left','right']){
    const a=anchors[side];
    const floor=[0,1,2].map(index=>percentile(a.map(row=>row[index].y),5));
    const velocity=a.map((row,f)=>row.map((anchor,index)=>{
      const lo=Math.max(f-1,0),hi=Math.min(f+1,clip.frames-1),delta=a[hi][index].clone().sub(a[lo][index]);
      return Math.hypot(delta.x,delta.z)*30/(hi-lo);
    }));
    const threshold=Math.max(.30,percentile(velocity.map(v=>Math.min(...v)),30)*1.6);
    const values=a.map((row,f)=>Math.max(...row.map((anchor,index)=>{
      const height=Math.min(1,Math.max(0,1-(anchor.y-floor[index]-.012)/.075));
      const speed=Math.min(1,Math.max(0,1-(velocity[f][index]-.18)/Math.max(.50,threshold)));
      return height*speed;
    })));
    result[side]=values.map((v,f)=>(values[(f+values.length-1)%values.length]+2*v+values[(f+1)%values.length])/4);
  }
  return result;
}
assert.equal(data.guardianMotion.version,1);
assert.equal(data.fps,30);
assert.deepEqual(Object.keys(data.clips).sort(),names);
assert.deepEqual(data.skeleton,original.skeleton);
assert.equal(data.guardianMotion.originalPackSha256,sha(read('.unlazy/guardian-motion/original-creature.json')));
assert.throws(()=>validateQuat([0,0,0,0]));
assert.throws(()=>validateContacts([1.5,0],2));

const unique=new Set();
const summary={};
for(const name of names){
  const clip=data.clips[name],source=clip.sourceMotion;
  const manifest=json(source.generationManifest);
  const rawRootBytes=read(`${source.rawDirectory}/root_positions.f32`);
  const rawRotBytes=read(`${source.rawDirectory}/local_rotations_xyzw.f32`);
  const rawRoot=floats(rawRootBytes),rawRot=floats(rawRotBytes);
  assert.equal(source.steps,100);assert.equal(manifest.steps,100);assert.equal(manifest.joints,30);
  assert.equal(source.seed,manifest.seed);assert.equal(manifest.name,name);
  assert.equal(manifest.frames,source.rawFrames);
  assert.equal(rawRoot.length,manifest.frames*3);assert.equal(rawRot.length,manifest.frames*30*4);
  assert.ok(rawRoot.every(Number.isFinite)&&rawRot.every(Number.isFinite));
  assert.equal(sha(rawRootBytes),source.rawSha256['root_positions.f32']);
  assert.equal(sha(rawRotBytes),source.rawSha256['local_rotations_xyzw.f32']);
  assert.deepEqual(manifest.streams,source.rawSha256);
  assert.equal(read(source.promptFile).toString(),manifest.prompt);
  assert.ok(manifest.elapsedSeconds>0&&manifest.elapsedSeconds<300);
  assert.equal(manifest.backend,'vulkan');assert.equal(manifest.models.motionModel.sha256,data.guardianMotion.model.sha256);
  assert.ok(manifest.models.executable.path.endsWith('kmd-generate.exe'));
  assert.ok(manifest.protocol.includes(`\t${source.seed}\t`));
  assert.ok(!unique.has(sha(rawRotBytes)));unique.add(sha(rawRotBytes));
  assert.notEqual(clip.rot,original.clips[name].rot,`${name}: old rotations are not reused`);
  const rot=i16(clip.rot,32767),positions=i16(clip.root,1000);
  assert.equal(rot.length,clip.frames*30*4);assert.equal(positions.length,clip.frames*3);
  validateQuat(rot);assert.ok(positions.every(Number.isFinite));

  // Independently connect the quantized pack to the selected native streams.
  // Up to the loop's final correction quarter, rotations must match aligned
  // real inference, including exact resampling for one-shot action duration.
  const turn=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-source.alignmentYaw);
  const tests=clip.loop?Math.floor(clip.frames*.65):clip.frames;
  for(let f=0;f<tests;f+=Math.max(1,Math.floor(tests/11))){
    let at;
    if(source.range)at=source.range[0]+f;
    else at=clip.loop?f:f/(clip.frames-1)*(source.rawFrames-1);
    const lo=Math.floor(at),hi=Math.min(source.rawFrames-1,lo+1),t=at-lo;
    for(let j=0;j<30;j++){
      const expected=quat(rawRot,lo*30+j).slerp(quat(rawRot,hi*30+j),t);
      if(j===0)expected.premultiply(turn);
      const actual=quat(rot,f*30+j);
      assert.ok(expected.angleTo(actual)<.0002,`${name}: source rotation ${f}/${j}`);
    }
    const y=rawRoot[lo*3+1]*(1-t)+rawRoot[hi*3+1]*t;
    assert.ok(Math.abs(positions[f*3+1]-y)<=.00051,`${name}: new Kimodo hip height`);
  }
  if(clip.loop){
    let maximum=0;
    for(let j=0;j<30;j++)maximum=Math.max(maximum,quat(rot,j).angleTo(quat(rot,(clip.frames-1)*30+j)));
    assert.ok(maximum<.0002,`${name}: rotation seam`);
    assert.ok(new Vector3().fromArray(positions).distanceTo(new Vector3().fromArray(positions,(clip.frames-1)*3))<.00001,`${name}: position seam`);
  }else{
    const old=i16(original.clips[name].root,1000);
    assert.equal(clip.frames,original.clips[name].frames);
    for(let f=0;f<clip.frames;f++)for(const axis of [0,2])assert.equal(positions[f*3+axis],old[f*3+axis],`${name}: gameplay root XZ unchanged`);
  }
  if(locomotion.includes(name)){
    for(const side of ['left','right'])validateContacts(clip.contacts[side],clip.frames);
    const measured=independentContacts(rot,positions,clip);
    for(const side of ['left','right'])for(let frame=0;frame<clip.frames;frame++)assert.ok(Math.abs(measured[side][frame]-clip.contacts[side][frame])<.05,`${name}: measured contact ${side}/${frame}`);
    assert.ok(clip.frames>=(name==='run'?36:54),`${name}: no tiny halfstep loop`);
    assert.ok(clip.speed>0&&clip.speed<7);
    const unsupported=clip.contacts.left.map((left,index)=>Math.max(left,clip.contacts.right[index])<.2);
    if(name!=='run')assert.ok(unsupported.filter(Boolean).length/clip.frames<.1,`${name}: sustained grounded support`);
    // Verify the source contains a full two-foot cycle independently of the
    // producer's stored metrics or asserted number of switches.
    const difference=[],left=[],right=[],ly=[],ry=[];
    const [first,last]=source.range;
    for(let f=first;f<last;f++){
      const p=fkFrame(rawRot,rawRoot,f,data.skeleton),l=p[24].clone().sub(p[0]).applyQuaternion(turn),r=p[28].clone().sub(p[0]).applyQuaternion(turn);
      left.push(l.z);right.push(r.z);difference.push(l.z-r.z);ly.push(p[24].y);ry.push(p[28].y);
    }
    let switches=0,leading=0;
    for(const value of difference){const next=value>.025?1:value<-.025?-1:leading;if(leading&&next!==leading)switches++;leading=next;}
    assert.ok(switches>=2,`${name}: both leading-foot switches`);
    assert.ok(Math.max(...left)-Math.min(...left)>.035&&Math.max(...right)-Math.min(...right)>.035);
    assert.ok(Math.max(...ly)-Math.min(...ly)>.015&&Math.max(...ry)-Math.min(...ry)>.015);
    assert.equal(review.selected[name],clip.src);
    const choices=review.candidates[name].filter(c=>!c.rejected);
    const chosen=choices.find(c=>c.seed===source.seed);
    assert.ok(chosen&&choices.every(c=>chosen.best.score<=c.best.score+1e-10));
    summary[name]={seed:source.seed,frames:clip.frames,speed:clip.speed,sourceLeadingFootSwitches:switches,contactMax:[Math.max(...clip.contacts.left),Math.max(...clip.contacts.right)]};
  }
}
assert.ok(review.candidates.walk.length>=3&&review.candidates.run.length>=3,'Multiple real locomotion candidates compared');
assert.equal(unique.size,13);
console.log(JSON.stringify(summary));
console.log('KIMODO_GUARDIAN_VERIFIED');
