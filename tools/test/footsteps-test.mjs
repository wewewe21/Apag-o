import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Audio } from '../../src/core/audio.js';
import { AudioLibrary } from '../../src/core/audio-library.js';
import { footstepMaterial, footstepSurfaceAt } from '../../src/core/footsteps.js';
import { Player } from '../../src/entities/player.js';
import { RemotePlayers } from '../../src/net/remote.js';
import { Grid } from '../../src/world/grid.js';
import { buildLayout } from '../../src/world/layout.js';
import { CATALOG } from '../audio/catalog.mjs';

const layout = buildLayout(), grid = new Grid(layout);
const calls = [], noises = [];
const game = { grid, camera: new THREE.PerspectiveCamera(), zoneAtPos: (x,z) => grid.zoneCfg(grid.cellX(x),grid.cellY(z)), makeNoise: (...v) => noises.push(v), audio: { footstep: (...v) => calls.push(v) } };
const cells = new Map();
for(let y=0;y<grid.H;y++)for(let x=0;x<grid.W;x++)if(grid.char(x,y)==='.') {
  const material=footstepMaterial(footstepSurfaceAt(game,grid.cx(x),grid.cz(y)));
  if(!cells.has(material)) cells.set(material,{x:grid.cx(x),y:grid.floorY(grid.cx(x),grid.cz(y)),z:grid.cz(y)});
}
assert.deepEqual([...cells.keys()].sort(),['asphalt','brick','concrete','lino','stone','tile','water','wood'].sort(),'todos os oito materiais estão presentes no mapa real');
assert.equal(footstepMaterial('morgue'),'tile');assert.equal(footstepMaterial('checker'),'tile');assert.equal(footstepMaterial('terrazzo'),'stone');
const player = game.player = new Player(game);
for(const [material,pos] of cells) { player.pos.copy(pos);player._footstep();assert.equal(footstepMaterial(calls.at(-1)[0]),material); }
assert.equal(noises.length,8,'baixar áudio não altera ruído percebido pela IA');
player.sprinting=true;player._footstep();const running=calls.at(-1)[1];player.sprinting=false;player.crouch=1;player._footstep();assert.ok(calls.at(-1)[1]<running,'agachar continua mais silencioso');
for(let y=0;y<grid.H;y++)for(let x=0;x<grid.W;x++)if(grid.char(x,y)==='=')assert.equal(footstepSurfaceAt(game,grid.cx(x),grid.cz(y)),'concrete');

// Executa o caminho cooperativo real, incluindo água e pisos de tijolo.
const remoteGame={...game};
const remote={g:remoteGame,avatars:new Map(),spots:Array.from({length:3},()=>({s:{intensity:0}}))};
for(const material of ['water','brick']) {
  const pos=cells.get(material),part=()=>new THREE.Object3D();
  const avatar={sample:()=>({...pos,yaw:0,pitch:0,crouch:0,flags:0}),group:new THREE.Group(),head:part(),body:part(),legL:part(),legR:part(),armL:part(),armR:part(),tag:{material:{}},lastFoot:{x:pos.x-1,z:pos.z},phase:0,stride:0,footAcc:0};
  remote.avatars.set(material,avatar);
}
RemotePlayers.prototype.update.call(remote,0.1,1);
assert.deepEqual(calls.slice(-2).map(v=>footstepMaterial(v[0])),['water','brick']);
assert.ok(calls.slice(-2).every(v=>v[2]&&Number.isFinite(v[2].y)),'coop mantém fonte posicional');

const audio=new Audio(game);audio.ready=true;const samples=[];audio._sample=(id,opts)=>{samples.push({id,opts});return true;};
audio.footstep('lino',0.65);audio.footstep('lino',0.65);
assert.ok(samples[0].opts.pos&&samples[1].opts.pos,'os próprios pés usam HRTF');
assert.ok(samples[0].opts.pos.x!==samples[1].opts.pos.x,'pés esquerdo/direito alternam no chão');
assert.ok(samples[0].opts.volume<0.33);assert.ok(samples[0].opts.rate>=0.985&&samples[0].opts.rate<=1.015);
audio.footstep('water',0.65,cells.get('water'));assert.equal(samples.at(-1).id,'step_water');
const ai={pos:cells.get('water'),moveSpeed:2,state:'patrol',visibleModel:true};audio.creatureSteps(ai,1);
const enemy=samples.at(-2);assert.equal(enemy.id,'creature_step');assert.ok(enemy.opts.important);assert.ok(enemy.opts.volume>samples[0].opts.volume*3);
assert.equal(samples.at(-1).id,'step_water','criatura também desloca água');
const before=samples.length;audio.creatureSteps(ai,0.01);assert.equal(samples.length,before,'cadência não duplica passos');
audio._sample=()=>false;audio.noise=()=>{throw new Error('passo sintético indevido');};audio.osc=audio.noise;audio.footstep('tile',1);

class Param { constructor(v=0){this.value=v;}setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}cancelScheduledValues(){} }
class Node {constructor(){for(const k of ['gain','frequency','Q','playbackRate','positionX','positionY','positionZ'])this[k]=new Param();this.connections=[];}connect(n){this.connections.push(n);}disconnect(){this.disconnected=true;}start(){}stop(){} }
const ctx={currentTime:0,createGain:()=>new Node(),createPanner:()=>new Node(),createBiquadFilter:()=>new Node(),createBufferSource:()=>new Node()};
const host={ctx,game:{...game,grid:{segmentClear:()=>true}},dry:new Node(),revSend:new Node()};host.game.camera.position.set(0,1.7,0);
const lib=Object.assign(Object.create(AudioLibrary.prototype),{ctx,host,buffers:new Map(),lastVariant:new Map(),variantBags:new Map(),lastPlay:new Map(),voices:new Set(),loops:new Map(),stats:{played:0},duckUntil:0});
lib.buffers.set('step_tile',Array.from({length:6},(_,variant)=>({duration:0.85,variant})));
const choices=[];for(let i=0;i<18;i++){lib.play('step_tile',{pos:{x:3,y:0,z:-3},reverb:0});choices.push(lib.lastVariant.get('step_tile'));}
for(let i=0;i<18;i+=6)assert.equal(new Set(choices.slice(i,i+6)).size,6,'todas as tomadas são usadas antes de repetir');
assert.ok(choices.every((v,i)=>!i||v!==choices[i-1]),'sem repetição entre ciclos');
const voice=[...lib.voices][0],route=voice.route;assert.equal(route.panner.panningModel,'HRTF');assert.equal(route.panner.channelCount,1);assert.equal(route.occluded,false);
host.game.grid.segmentClear=()=>false;ctx.currentTime=0.1;lib.updateSpatial();assert.equal(route.occluded,true);assert.equal(route.filter.frequency.value,850);assert.equal(route.muffle.gain.value,0.55);
host.game.grid.segmentClear=()=>true;ctx.currentTime=0.2;lib.updateSpatial();assert.equal(route.occluded,false);assert.ok(route.filter.frequency.value>15000);assert.equal(route.muffle.gain.value,1);
host.game.camera.position.set(0,-5,0);ctx.currentTime=0.3;lib.updateSpatial();assert.equal(route.occluded,true,'outro andar é abafado');
voice.source.onended();assert.ok(route.nodes.every(n=>n.disconnected),'roteamento espacial é liberado ao terminar');
assert.ok(CATALOG.filter(a=>a.footstep).every(a=>a.variants===6&&a.mono),'catálogo tem seis tomadas mono por identidade');
console.log('FOOTSTEPS_VERIFIED: oito materiais reais, água coop, prioridade do inimigo, variações sem repetição e HRTF/oclusão dinâmica.');
