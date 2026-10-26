// Opt-in inspection of the real game FBX, lights, doors and animation controller.
import * as THREE from 'three';
import { pointObstaclePenetration } from '../src/shared/creature-clearance.js';

export function install(game) {
  const panel=document.createElement('section'); panel.id='skinwalkerQa';
  panel.style.cssText='position:fixed;z-index:99999;right:12px;top:12px;width:290px;max-height:84vh;overflow:auto;background:#101615ee;color:#e6eee6;border:1px solid #7e9184;padding:14px;font:12px/1.45 monospace';
  panel.innerHTML='<strong>APAGÃO · Skinwalker</strong><p><button id="swVerify">Verificar rig e movimentos</button></p><div id="swClips"></div><p><button id="swMove">Andar</button> <button id="swPause">Pausar</button></p><p><button id="swFront">Frente</button> <button id="swSide">Perfil</button> <button id="swHands">Mãos</button></p><p><button id="swDoorH">Porta horizontal</button> <button id="swDoorV">Porta vertical</button></p><p><button id="swReverse">Sentido inverso</button> <button id="swJamb">No batente</button> <button id="swRoom">Voltar à sala</button></p><label>Quadro <input id="swPhase" type="range" min="0" max="100" value="0"></label><p><button id="swClose">Fechar painel</button></p><pre id="swResult" style="white-space:pre-wrap">Aguardando modelo.</pre>';
  document.body.append(panel);
  const output=panel.querySelector('pre'), control=id=>panel.querySelector('#'+id);
  let ready=false, spot, clock=0, last=0, reportAt=0, playing=true, moving=false, side=false, hands=false, selected='idle', door=null, direction=1, travel=0;
  let peakPenetration=0, peakHead=0, minimumSole=Infinity,fill;
  const point=new THREE.Vector3(), target=new THREE.Vector3();
  const movable=new Set(['walk','run','stalk','creep','limp','crawl']);
  const input={mouse:{dx:0,dy:0,right:false},down:()=>false,hit:()=>false};
  const model=()=>game.creatureModel;
  async function prepare() {
    if(!game.world) { await import('./test/pointerlock-mock.js'); window.PLM.activeUntil=performance.now()+120000; await game.start(false,'hardcore'); }
    if(!model()?.skinwalkerMotion) throw new Error('O FBX e perfil skinwalker precisam estar ativos');
    game.state='paused'; document.getElementById('pause').hidden=true;
    game.freezeAI=true; game.ai.state='patrol'; game.ai.visibleModel=true;
    game.paranoia.reset(); game.post.uniforms.paranoia.value=0;
    game.post.uniforms.fade.value=0; game.post.uniforms.pulse.value=0;
    if(!spot) {
      for(let y=18;y<=22&&!spot;y++) for(let x=24;x<=29&&!spot;x++) {
        const px=game.grid.cx(x),pz=game.grid.cz(y),[qx,qz]=game.grid.collideCircle(px,pz,.5);
        if(Math.hypot(qx-px,qz-pz)<.01 && game.grid.segmentClear(px,pz+4,px,pz,true)) spot={x:px,z:pz};
      }
      spot ||= {x:game.grid.cx(26),z:game.grid.cz(20)};
      const light=new THREE.HemisphereLight(0xdfe9df,0x35312d,.85); light.name='SkinwalkerPreviewFill'; game.scene.add(light);
      fill=new THREE.DirectionalLight(0xe6e1d4,1.4);fill.name='SkinwalkerPreviewKey';fill.target=model().group;game.scene.add(fill);
    }
    const m=model(); m.group.visible=true; m.group.scale.setScalar(1); m.lookTarget=null; m.lookWeight=0;
    if(!ready) { m.group.position.set(spot.x,0,spot.z); m.group.rotation.y=0; ready=true; }
    aim();
  }
  function aim() {
    const m=model(),p=m.group.position;
    // This isolated pose preview drives the real model directly. Keep its
    // navigation owner at the same root for completed-pose reconciliation.
    game.ai.pos.copy(p);game.ai.yaw=m.group.rotation.y;
    target.set(p.x,p.y+(door?1.1:1.35),p.z);
    if(hands) { m.guardian.bones.LeftHand.getWorldPosition(target); }
    let angle=m.group.rotation.y+(side?Math.PI/2:0),dist=hands?1.25:door?2.6:4.4;
    if(door&&!hands) {
      // Short rooms cannot host the normal four-metre inspection camera.
      // Select a visible free viewpoint without changing gameplay cameras.
      let found=false;
      for(const turn of [0,.35,-.35,.7,-.7,Math.PI]) {
        for(let d=2.6;d>=1.5;d-=.2) {
          const a=angle+turn,x=target.x+Math.sin(a)*d,z=target.z+Math.cos(a)*d;
          const [qx,qz]=game.grid.collideCircle(x,z,.08,{ignore:b=>!b.vision});
          if(Math.hypot(qx-x,qz-z)<.01&&game.grid.segmentClear(p.x,p.z,x,z,true)) {angle=a;dist=d;found=true;break;}
        }
        if(found)break;
      }
    }
    game.camera.position.set(target.x+Math.sin(angle)*dist,target.y+(hands?.18:.08),target.z+Math.cos(angle)*dist);
    game.camera.lookAt(target); game.camera.updateMatrixWorld(true);
    if(fill)fill.position.set(p.x+1.8,p.y+3.6,p.z+2.8);
    game.player.pos.copy(game.camera.position); game.player.yaw=angle+Math.PI;
    game.flashlight.on=true;game.flashlight.battery=1;game.flashlight.update(.01,input,false);
  }
  function reset(key) {
    const m=model(); selected=key; m.mixer.stopAllAction();m.current=null;m.painT=-1;m.shield=0;
    m.guardian.resetMotion();m.play(key==='pain'||key==='shield'?'idle':key,0,{restart:true});
    if(key==='pain')m.flinch();if(key==='shield')m.setShield(.9);
    peakPenetration=0;peakHead=0;minimumSole=Infinity;travel=0;playing=true;
  }
  function report() {
    const m=model(),metrics={...m.guardian.metrics,...m.guardian.motion.metrics};
    output.textContent=`${selected} · KIMODO · SKINWALKER 3m\n${door?'Passagem real · '+door.axis+' · sentido '+direction:moving?'Deslocamento animado':'Pose no lugar'}\n${m.data.clips[m.current]?.frames} quadros · ${m.duration(m.current).toFixed(2)}s\n${JSON.stringify({...metrics,peakPenetration,peakHead,minimumSole},null,2)}`;
  }
  for(const key of ['idle','walk','run','stalk','creep','limp','crawl','look','inspect','attack','roar','recoil','pain','shield']) {
    const b=document.createElement('button');b.textContent=key;b.style.cssText='margin:2px;padding:5px';
    b.onclick=async()=>{try{await prepare();reset(key);report();}catch(e){output.textContent='FAIL '+e.message;}};control('swClips').append(b);
  }
  control('swMove').onclick=async()=>{await prepare();moving=!moving;travel=0;model().guardian.resetMotion();};
  control('swPause').onclick=()=>{playing=!playing;control('swPause').textContent=playing?'Pausar':'Reproduzir';};
  control('swFront').onclick=async()=>{await prepare();side=false;hands=false;aim();};
  control('swSide').onclick=async()=>{await prepare();side=true;hands=false;aim();};
  control('swHands').onclick=async()=>{await prepare();hands=true;aim();};
  async function through(axis) {
    await prepare(); const grid=game.grid;
    const choices=[...new Set(grid.doors.values())].filter(d=>d.axis===axis&&d.creaturePassable()&&d.base===0);
    door=choices.find(d=> {
      const ax=d.cx-(axis==='v'?1.6:0),az=d.cz-(axis==='h'?1.6:0);
      const bx=d.cx+(axis==='v'?1.6:0),bz=d.cz+(axis==='h'?1.6:0);
      const [qx,qz]=grid.collideCircle(ax,az,.38),[rx,rz]=grid.collideCircle(bx,bz,.38);
      return Math.hypot(qx-ax,qz-az)<.01&&Math.hypot(rx-bx,rz-bz)<.01;
    })||choices[0];
    if(!door)throw new Error('Porta ausente');
    door.setOpen(true,door.cx-(axis==='v'?direction:0),door.cz-(axis==='h'?direction:0),true);
    door.open=1;door._pose?.(); moving=true;hands=false;reset('creep');
    const m=model();m.group.rotation.y=axis==='h'?(direction===1?0:Math.PI):(direction===1?Math.PI/2:-Math.PI/2);
    place(-2);m.update(1/30,door.base,clock);aim();report();
  }
  function place(normal) {
    model().group.position.set(door.cx+(door.axis==='v'?direction*normal:0),door.base,door.cz+(door.axis==='h'?direction*normal:0));
  }
  control('swDoorH').onclick=()=>through('h').catch(e=>output.textContent='FAIL '+e.message);
  control('swDoorV').onclick=()=>through('v').catch(e=>output.textContent='FAIL '+e.message);
  control('swReverse').onclick=()=>{direction*=-1;if(door)through(door.axis);};
  control('swJamb').onclick=async()=>{
    if(!door)await through('h');
    moving=false;playing=false;place(-.1);
    const m=model();m.guardian.resetMotion();m.actions[m.current].time=m.duration(m.current)*.33;
    game.ai.pos.copy(m.group.position);game.ai.yaw=m.group.rotation.y;
    m.update(1/30,door.base,clock);aim();report();
  };
  control('swRoom').onclick=async()=>{await prepare();door=null;moving=false;model().group.position.set(spot.x,0,spot.z);model().group.rotation.y=0;reset(selected);aim();};
  control('swPhase').oninput=async e=>{await prepare();playing=false;const m=model();m.guardian.resetMotion();m.actions[m.current].time=+e.target.value/100*m.duration(m.current);m.update(0,m.group.position.y,clock);aim();report();};
  control('swClose').onclick=()=>panel.hidden=true;
  control('swVerify').onclick=async()=>{
    const lines=[],check=(ok,label)=>{if(!ok)throw new Error(label);lines.push('PASS '+label);output.textContent=lines.join('\n');};
    try {
      await prepare(); playing=false;moving=false;door=null;
      const m=model(),meshes=[];m.guardianRoot.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
      check(m.skinwalkerMotion&&m.data.guardianMotion.version===2,'novo perfil e movimentos locais Kimodo');
      check(meshes.length===1&&meshes[0].geometry.attributes.position.count===37524,'malha original Mixamo');
      check(meshes.every(mesh=>[].concat(mesh.material).every(mat=>!mat.map||(mat.map.image?.naturalWidth??mat.map.image?.width)>0)),'textura real decodificada');
      check(m.guardian.fingers.length===30,'30 juntas dos dedos longos');
      check(Math.abs(m.guardianRoot.userData.guardianAsset.height*1.3-3)<1e-6,'escala original de três metros');
      check(m.doorwayTracks.length>=14&&m.doorwayTracks.every(t=>!/(Hips|Leg|Shin|Foot|Toe)/.test(t.bone.name)),'camada de passagem preserva pernas');
      for(const key of ['idle','walk','run','stalk','creep','limp','crawl','look','inspect','attack','roar','recoil']) {
        reset(key);m.update(1/30,0,clock);
        const before=m.guardian.bones.LeftFoot.quaternion.clone(),fingers=m.guardian.fingers.map(f=>f.bone.quaternion.clone());
        for(let i=0;i<25;i++)m.update(1/30,0,clock+i/30);
        check(m.actions[key].enabled&&m.actions[key].time>0,key+': ação avança');
        check(m.guardian.fingers.some((f,i)=>f.bone.quaternion.angleTo(fingers[i])>.002),key+': dedos articulados');
        if(movable.has(key))check(m.guardian.bones.LeftFoot.quaternion.angleTo(before)>.02,key+': pernas animadas');
        check(Math.abs(m.guardian.supportY())<.12,key+': apoio real no piso');
      }
      lines.push('SKINWALKER_BROWSER_VERIFIED');output.textContent=lines.join('\n');reset('creep');playing=false;aim();
    }catch(e){lines.push('FAIL '+e.message);output.textContent=lines.join('\n');playing=false;}
  };
  function frame(now) {
    requestAnimationFrame(frame);const dt=Math.min(.05,(now-(last||now))/1000);last=now;
    if(!ready||!playing||!model()?.guardian)return;
    const m=model();clock+=dt;
    if(moving&&movable.has(m.current)) {
      travel+=m.clipSpeed(m.current)*dt;
      if(door) {place(-2+travel);if(travel>4.2){moving=false;playing=false;}}
      else {if(travel>2.5){travel=0;m.guardian.resetMotion();}m.group.position.set(spot.x,0,spot.z+travel);}
    }
    game.ai.pos.copy(m.group.position);game.ai.yaw=m.group.rotation.y;
    m.update(dt,m.group.position.y,clock);aim();
    if(door) {
      for(const s of m.guardian.skinSamples){s.mesh.getVertexPosition(s.index,point);s.mesh.localToWorld(point);peakPenetration=Math.max(peakPenetration,pointObstaclePenetration(point,0,m.clearance.obstacles));}
      peakHead=Math.max(peakHead,m.guardian.motion.metrics.headTopY);minimumSole=Math.min(minimumSole,m.guardian.supportY());
    }
    control('swPhase').value=(m.actions[m.current]?.time??0)/m.duration(m.current)*100;
    if(now>reportAt){reportAt=now+350;report();}
  }
  requestAnimationFrame(frame);
}
