import assert from 'node:assert/strict';
import { AudioLibrary, soundscape } from '../../src/core/audio-library.js';
import { Audio } from '../../src/core/audio.js';
import { CATALOG } from '../audio/catalog.mjs';

class Param {
  constructor(v=0) { this.value=v; this.events=[]; }
  setValueAtTime(v,t) { this.value=v; this.events.push([v,t]); }
  setTargetAtTime(v,t,k) { this.value=v; this.events.push([v,t,k]); }
  linearRampToValueAtTime(v,t) { this.value=v; this.events.push([v,t]); }
  exponentialRampToValueAtTime(v,t) { this.value=v; this.events.push([v,t]); }
  cancelScheduledValues() {}
}
class Node {
  constructor(ctx) { this.ctx=ctx; this.gain=new Param(); this.frequency=new Param(); this.Q=new Param(); this.pan=new Param(); this.playbackRate=new Param(1); this.positionX=new Param(); this.positionY=new Param(); this.positionZ=new Param(); this.connections=[]; }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected=true; this.connections=[]; }
  start(t=0) { this.started=t; }
  stop(t=0) { this.stopped=t; }
  end() { this.onended?.(); }
}
class Context {
  constructor() { this.currentTime=0; this.nodes=[]; }
  make() { const n=new Node(this); this.nodes.push(n); return n; }
  createGain() { return this.make(); }
  createBufferSource() { return this.make(); }
  createPanner() { return this.make(); }
  createStereoPanner() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createOscillator() { const n=this.make(); n.oscillator=true; return n; }
  createWaveShaper() { return this.make(); }
  async decodeAudioData() { return { duration:10 }; }
}
const game = { state:'playing', player:{ stamina:1, hidden:null, dead:false }, camera:{ position:{x:0,y:1.7,z:0} }, grid:{segmentClear:()=>true}, ai:{state:'patrol',pos:{x:6,y:0,z:4}}, director:{finale:false}, lighting:{lamps:[]} };
let state = {zone:{level:0},fear:0,monsterDist:Infinity};
assert.equal(soundscape(game,state).music,'score_explore');
assert.equal(soundscape(game,{...state,zone:{level:-1}}).music,'score_basement');
assert.equal(soundscape(game,{...state,fear:0.7}).music,'score_stalk');
game.ai.state='chase'; state.monsterDist=8;
assert.equal(soundscape(game,state).music,'score_chase');
assert.equal(soundscape(game,{...state,monsterDist:90}).music,'score_explore');
game.player.hidden={type:'locker'};
assert.equal(soundscape(game,state).music,'score_stalk');
assert.ok(soundscape(game,state).musicLevel < 0.2);
game.player.hidden=null; game.ai.state='patrol'; game.director.finale=true;
assert.equal(soundscape(game,state).music,'score_finale');
game.state='paused'; game.online={};
assert.ok(soundscape(game,state).active, 'coop não pausa a paisagem sonora');
game.online=null;
game.online={me:2,players:new Map([[2,{status:'escaped'}]])};assert.equal(soundscape(game,state).music,'score_escape');game.online=null;
assert.equal(soundscape(game,state).active,false);
game.state='won'; assert.equal(soundscape(game,state).music,'score_escape');
game.state='dead'; assert.equal(soundscape(game,state).music,null);
game.state='playing'; game.director.finale=false;
game.objectives={charging:true};assert.equal(soundscape(game,state).music,'score_finale');game.objectives.charging=false;
for (const [zone,expected] of [[{outside:true},'amb_rain'],[{cold:true},'amb_morgue'],[{water:true},'amb_water'],[{amb:'noturna'},'amb_noturna'],[{amb:'boiler'},'amb_boiler']]) assert.equal(soundscape(game,{...state,zone}).ambience,expected);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok:true,json:async()=>({version:1,status:'awaiting_credentials',assets:{}}) });
const ctx = new Context();
const host = { ctx,game,dry:ctx.make(),revSend:ctx.make(),beatDuck:ctx.make(),amb:ctx.make(),rain:ctx.make(),breathG:ctx.make(),hums:[],duckBeat:()=>{},_randomFarPoint:()=>({x:8,y:1,z:8}) };
const library = new AudioLibrary(host); await library.loaded;
assert.equal(library.play('missing'),false);
library.update(0.1,state);
assert.equal(library.stats.played,0,'catálogo vazio mantém somente os sons existentes');
for (const asset of CATALOG) library.buffers.set(asset.id, Array.from({length:asset.variants},(_,i)=>({duration:asset.type==='music'?30:asset.loop?12:1,variant:i})));
library.update(0.1,state);
assert.equal(library.stats.music,'score_explore');
const musicLoop = library.loops.get('score_explore');
assert.equal(musicLoop.sources.size,1);
ctx.currentTime=27.6; library.update(0.1,state);
assert.equal(musicLoop.sources.size,2,'fim e início se sobrepõem');
game.ai.state='chase'; state.monsterDist=6; library.update(0.1,state);
assert.equal(library.stats.music,'score_chase');
assert.equal(musicLoop.target,0,'a trilha anterior recebe fade');
game.player.hidden={}; library.update(0.1,state); library.update(3,state);
assert.equal(library.stats.music,'score_stalk');
game.player.holdingBreath=true; library.update(0.1,state);
assert.equal(library.loops.get('breath_calm')?.target,0);
assert.equal(library.loops.get('breath_panic')?.target || 0,0);
game.player.holdingBreath=false; game.player.hidden=null;
for (let i=0;i<40;i++) library.play('creature_step',{important:true});
assert.equal(library.voices.size,24,'limite também vale para pistas importantes');
library.play('whisper',{cooldown:2}); const played=library.stats.played;
assert.equal(library.play('whisper',{cooldown:2}),true);
assert.equal(library.stats.played,played,'cooldown não cai para o som procedural');
library.play('heartbeat',{volume:0.1,reverb:0});
assert.ok(ctx.nodes.some(n=>n.connections.includes(host.beatDuck)),'batimento gerado também obedece ducking');
game.grid.segmentClear=()=>false;
library.play('door_slam',{pos:{x:8,y:1,z:3},important:true});
assert.ok(ctx.nodes.some(n=>n.type==='lowpass' && n.frequency.value===850),'oclusão filtra o áudio gerado');
assert.ok(library.duckUntil>ctx.currentTime);
const indices=[];
for (let i=0;i<20;i++) { library.play('step_tile'); indices.push(library.lastVariant.get('step_tile')); }
assert.ok(indices.every((v,i)=>!i||v!==indices[i-1]),'não repetir a mesma variante de passo');
game.state='won'; library.update(0.1,state);
const escape=library.loops.get('score_escape'); assert.equal(escape.once,true);
ctx.currentTime+=45; library.update(45,state);
assert.equal(escape.sources.size,1,'fuga toca uma única vez');
const loopNodes=[...library.loops.values()].flatMap(l=>[l.gain,...l.sources.values()]);
library.reset();
assert.equal(library.loops.size,0); assert.equal(library.voices.size,0);
assert.ok(loopNodes.every(n=>n.disconnected),'fontes e envelopes são desconectados');

// Exercita os métodos de integração com o jogo e os passos cooperativos.
const audio = new Audio(game); audio.ready=true; audio.ctx=ctx; audio.library=library;
audio.dry=host.dry; audio.revSend=host.revSend; audio.beatDuck=host.beatDuck; audio.heartG=ctx.make();
const calls=[]; audio._sample=(id,opts)=>{calls.push({id,opts});return true;};
const pos={x:4,y:0,z:7};
for (const material of ['water','wood','concrete','lino']) audio.footstep(material,0.8,pos);
assert.equal(calls[0].opts.pos.x,4); assert.equal(calls[0].opts.pos.y,0.06);
audio.gasp();audio.click(true);audio.click(false);audio.thump();audio.overheat();audio.metalHit(pos);audio.doorSlam(pos);audio.doorRattle(pos);audio.creak(pos);audio.doorClose(pos);audio.lockerBang(pos);audio.lockerMove(pos);audio.drawer(pos);audio.pickup('map');audio.pickup('key');audio.pickup('fuse');audio.fuseInsert(pos);audio.lightsOn();audio.lampBurst(pos);audio.lever();audio.unlock();audio.ventRattle(pos);audio.whisper(pos);audio.radio(pos);audio.stinger();audio.death();
for (const kind of ['click','breath','sniff','pain','moan','growl','roar','attack','screech','hiss']) audio.creatureCry(pos,kind);
assert.ok(!calls.some(c=>['death','creature_attack'].includes(c.id)),'captura usa o som original mesmo com masters disponíveis');
assert.equal(calls.filter(c=>c.id==='stinger').length,1,'captura não substitui o impacto original pelo stinger ElevenLabs');
assert.ok(ctx.nodes.some(n=>n.oscillator&&n.type==='sine'&&n.frequency.value===4200&&n.started!==undefined),'zumbido original de morte é reproduzido');
assert.ok(calls.every(c=>CATALOG.some(a=>a.id===c.id)),'todo evento integrado corresponde ao catálogo');
// Arquivo inválido e caminho remoto são recusados sem quebrar a partida.
globalThis.fetch=async()=>({ok:true,json:async()=>({version:1,assets:{bad:[{file:'https://example.com/file.ogg'}]}})});
const invalid = new AudioLibrary(host);await invalid.loaded;assert.deepEqual(invalid.entries,{});
invalid.entries.broken=[{file:'broken.ogg'}];
globalThis.fetch=async()=>({ok:false});assert.equal(await invalid.ensure('broken'),null);
assert.equal(invalid.play('broken'),false);
globalThis.fetch=originalFetch;
console.log('AUDIO_RUNTIME_VERIFIED: transições, coop, HRTF/oclusão, ducking, loops, limites, descarte, eventos e fallback.');
