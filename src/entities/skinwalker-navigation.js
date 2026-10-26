// Grid navigation treats an open door as an opening. Its hinged physical leaf
// still needs a small local detour, especially when approaching from the hinge.
import { CREATURE } from '../config.js';
import { sampleCreatureClearance, projectBodyOutOfObstacles, sweepCircleAgainstBox } from '../shared/creature-clearance.js';

export function skinwalkerWaypoint(grid,pos,tx,tz,speed,scratch={}) {
  const dx=tx-pos.x,dz=tz-pos.z,distance=Math.hypot(dx,dz);
  if(distance<.05)return null;
  const reach=Math.min(distance,2.4),end={x:pos.x+dx/distance*reach,y:pos.y+.95,z:pos.z+dz/distance*reach};
  const start={x:pos.x,y:end.y,z:pos.z},radius=CREATURE.bodyRadius;
  const c=sampleCreatureClearance(grid,pos.x,pos.z,Math.atan2(dx,dz),pos.y,speed,0,scratch);
  if(c.overflow)return null;
  const obstacles=c.obstacles.filter(o=>o.blocking!==false&&o.kind!=='lintel'&&c.sweep.y1>o.y0&&c.sweep.y0<o.y1);
  const hit={};let leaf=null,first=1;
  for(const o of obstacles)if(o.kind==='doorLeaf') {
    sweepCircleAgainstBox(start,end,o,radius,hit);
    if(hit.hit&&hit.t<first){first=hit.t;leaf=o;}
  }
  if(!leaf)return null;
  const projected={};
  const free=p=>{
    const [x,z]=grid.collideCircle(p.x,p.z,radius);
    if(Math.hypot(x-p.x,z-p.z)>.001)return false;
    projectBodyOutOfObstacles(p,radius,c.sweep.y0,c.sweep.y1,obstacles,projected);
    return Math.hypot(projected.x-p.x,projected.z-p.z)<.001;
  };
  const clear=(a,b)=>{
    for(const o of obstacles){sweepCircleAgainstBox(a,b,o,radius,hit);if(hit.hit)return false;}
    return true;
  };
  const nodes=[start,end];
  // Two nearby leaves (double doors) remain bounded to ten graph nodes. Extra
  // corners only help when every connecting segment actually stays clear.
  const leaves=[leaf,...obstacles.filter(o=>o.kind==='doorLeaf'&&o!==leaf).slice(0,1)];
  for(const o of leaves) {
    const cos=Math.cos(o.yaw),sin=Math.sin(o.yaw),hx=o.hx+radius+.045,hz=o.hz+radius+.045;
    for(const sx of [-1,1])for(const sz of [-1,1]) {
      const p={x:o.cx+cos*sx*hx+sin*sz*hz,y:end.y,z:o.cz-sin*sx*hx+cos*sz*hz};
      if(free(p))nodes.push(p);
    }
  }
  const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set();costs[0]=0;
  for(let step=0;step<nodes.length;step++) {
    let i=-1;for(let k=0;k<nodes.length;k++)if(!done.has(k)&&(i<0||costs[k]<costs[i]))i=k;
    if(i<0||!Number.isFinite(costs[i]))break;if(i===1)break;done.add(i);
    for(let j=1;j<nodes.length;j++)if(!done.has(j)&&j!==i&&clear(nodes[i],nodes[j])) {
      const cost=costs[i]+Math.hypot(nodes[j].x-nodes[i].x,nodes[j].z-nodes[i].z);
      if(cost<costs[j]){costs[j]=cost;previous[j]=i;}
    }
  }
  if(previous[1]<0)return null;
  let next=1;while(previous[next]>0)next=previous[next];
  return nodes[next];
}
