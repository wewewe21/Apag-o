import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimData } from '../../src/shared/animdata.js';
import { HeadlessCreatureModel } from '../../server/headless-model.js';
import { CreatureAI } from '../../src/entities/creatureAI.js';
import { CREATURE } from '../../src/config.js';
import { sampleCreatureClearance,pointBoxSignedDistance } from '../../src/shared/creature-clearance.js';
import { doorwayFixture } from './skinwalker-fixture.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../../assets/anim/creature.json',import.meta.url)));
function actor(g){const m=new HeadlessCreatureModel(new AnimData(data)),game={grid:g},ai=new CreatureAI(game,m);game.ai=ai;ai.state='patrol';return ai;}
let assertions=0;
for(const low of [0,1.2])for(const step of [1,1.534,2.322]) {
  const {g}=doorwayFixture();g.addBox({x0:2.975,x1:3.025,z0:2.5,z1:3.5,y0:low,y1:2,vision:true});
  const ai=actor(g),start=3-step*.5;ai.pos.set(start+step,0,3);ai._collisionPosition={x:start,z:3};ai.moveSpeed=6.136;
  ai.collideBody();assert.ok(ai.pos.x<=2.595,'fast legal body step cannot cross a thin/elevated torso prop');assertions++;
}
for(const depth of [.001,.004,.006]) {
  const {g}=doorwayFixture();g.addBox({x0:2.975,x1:3.025,z0:2.5,z1:3.5,y0:1.2,y1:2,vision:true});
  const ai=actor(g);ai.pos.set(2.975-CREATURE.bodyRadius+depth,0,3);ai._collisionPosition={x:ai.pos.x,z:3};
  ai.collideBody();assert.ok(ai.pos.x<=2.595,'initial millimetre penetration recovers outward');assertions++;
}
{
  const {g}=doorwayFixture();g.addBox({x0:2.75,x1:2.8,z0:2.5,z1:3.5,y0:1.2,y1:2,vision:true});
  const ai=actor(g);ai.pos.set(4.52190842,0,3);ai._collisionPosition={x:2.2,z:3};ai.yaw=Math.PI/2;ai.moveSpeed=9.28763368;
  ai.collideBody();assert.ok(ai.pos.x<=2.37,'late-coop candidates include obstacles behind the endpoint');assertions++;
}
const routes=[];
for(const axis of ['h','v'])for(const sign of [-1,1]) {
  const {g,d}=doorwayFixture(axis);d.open=1;d.target=1;d.dir=axis==='h'?sign:-sign;
  const ai=actor(g),tangent=-.95,normal=sign*1.25;
  ai.pos.set(d.cx+(axis==='h'?tangent:normal),0,d.cz+(axis==='h'?normal:tangent));
  const target=[d.cx+(axis==='v'?-sign*1.25:0),d.cz+(axis==='h'?-sign*1.25:0)];
  ai.path=[[ai.pos.x,ai.pos.z],target];ai.pathI=1;let arrived=false,steps=0,minClear=Infinity;
  for(;steps<300&&!arrived;steps++) {
    const before=ai.pos.clone();arrived=ai.follow(1.25,1/30);ai.m.group.position.copy(ai.pos);ai.m.group.rotation.y=ai.yaw;ai.animate(1/30);ai.m.update(1/30);
    const c=sampleCreatureClearance(g,ai.pos.x,ai.pos.z,ai.yaw,0,ai.moveSpeed,0,{});
    // Independently sample the whole travelled chord, including both endpoints.
    for(const o of c.obstacles)if(o.kind!=='lintel'&&o.y0<c.sweep.y1&&o.y1>c.sweep.y0)for(let i=0;i<=8;i++) {
      const t=i/8,p={x:before.x+(ai.pos.x-before.x)*t,y:(o.y0+o.y1)*.5,z:before.z+(ai.pos.z-before.z)*t};
      minClear=Math.min(minClear,pointBoxSignedDistance(p,o)-CREATURE.bodyRadius);
    }
  }
  assert.ok(arrived,`hinge-side physical detour reaches opposite room ${axis}/${sign}`);
  assert.ok(minClear>=-.003,`continuous torso path avoids the actual rotating leaf/jamb ${minClear}`);assertions+=2;
  routes.push({axis,sign,steps,minClear});
}
console.log(JSON.stringify({assertions,routes}));console.log('SKINWALKER_NAVIGATION_VERIFIED');
