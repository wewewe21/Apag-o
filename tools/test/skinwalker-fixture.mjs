import * as THREE from 'three';
import { Grid } from '../../src/world/grid.js';
import { DoorCore } from '../../src/world/doorcore.js';

export function doorwayFixture(axis='h',level=0) {
  const W=15,H=15,rows=Array.from({length:H},()=>Array(W).fill('.'));
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x===0||y===0||x===W-1||y===H-1||(axis==='h'?y===7:x===7))rows[y][x]='#';
  rows[7][7]='D';
  const g=new Grid({W,H,grid:rows,zone:rows.map(r=>r.map(()=> 'r')),zones:{r:{level,wall:'clinic',ceil:'tiles'}},objects:[]});
  const d=new DoorCore(g,7,7,'D');
  return {g,d};
}
export function skinPoints(model,indices) {
  const points=[];model.group.updateMatrixWorld(true);
  model.guardianRoot.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    for(const index of indices??Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i))points.push(mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  });return points;
}
export function begin(model,name) {
  model.mixer.stopAllAction();model.current=null;model.painT=-1;model.shield=0;model.groundOffset=0;
  model.play(name,0,{restart:true});
}
