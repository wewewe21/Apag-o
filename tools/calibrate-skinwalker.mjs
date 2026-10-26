// Offline measurement of the actual authored skin anchors after public update.
// This is run after the native producer has released its animation pack lease.
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { CreatureModel } from '../src/entities/creature.js';
import { parseSkinwalkerForInspection } from './skinwalker-asset-inspect.mjs';

const file=new URL('../assets/anim/creature.json',import.meta.url);
const data=JSON.parse(await fs.readFile(file,'utf8'));
if(data.guardianMotion?.profile!=='skinwalker')throw new Error('Native skinwalker pack required');
const {asset,sha256}=await parseSkinwalkerForInspection();
const model=new CreatureModel(structuredClone(data),null,null,asset);
const anatomy={version:1,assetSha256:sha256,authoredHeight:3,strideScale:model.strideScale,
  sampleCount:32,ducks:[0,.5,1],method:'actual FBX weighted anchors; public retarget, sole contact and native upper-body doorway layer',clips:{}};
const loopNames=new Set(['walk','run','creep','stalk','limp','crawl']);
for(const [key,info] of Object.entries(data.clips)) {
  const poses=[];let maxReach=0;
  for(const duck of anatomy.ducks) {
    model.mixer.stopAllAction();model.current=null;model.painT=-1;model.shield=0;
    model.group.position.set(0,0,0);model.groundOffset=0;model.guardian.resetMotion();
    model.play(key,0,{restart:true});
    model.clearance={duck,ceilingY:duck?3-.95*duck:3.2,door:null,obstacles:[]};
    model.guardianState.clearance=model.clearance;
    const points=[];
    const dur=model.duration(key),step=dur/32;
    for(let i=0;i<32;i++) {
      if(loopNames.has(key))model.group.position.z+=model.clipSpeed(key)*step;
      model.actions[key].time=i*step;
      model.update(0,0,i*step);
      // First support correction can be discontinuous from a bind pose; settle
      // the measured pose without advancing the source clip or contact phase.
      model.update(.001,0,i*step);
      const head=model.headWorld().sub(model.group.position),chest=model.chestWorld().sub(model.group.position);
      maxReach=Math.max(maxReach,Math.hypot(head.x,head.z));
      points.push([...head.toArray(),...chest.toArray()].map(v=>+v.toFixed(5)));
    }
    poses.push(points);
  }
  anatomy.clips[key]={headReach:+(maxReach+.035).toFixed(5),poses};
}
data.guardianMotion.anatomy=anatomy;
const output=process.argv.includes('--draft')?new URL('../.unlazy/skinwalker/anatomy-draft.json',import.meta.url):file;
await fs.writeFile(output,JSON.stringify(process.argv.includes('--draft')?anatomy:data));
console.log(JSON.stringify({assetSha256:sha256,strideScale:model.strideScale,clips:Object.keys(anatomy.clips).length,headReach:Object.fromEntries(Object.entries(anatomy.clips).map(([k,c])=>[k,c.headReach]))}));
console.log('SKINWALKER_ANATOMY_CALIBRATED');
