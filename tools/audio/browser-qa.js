// Verificação opt-in do jogo real: /index.html?debug&audioqa.
// Os controles e medições ficam visíveis no painel de teste.
export function install(game) {
  const panel=document.createElement('section');
  panel.id='audioQa';panel.style.cssText='position:fixed;z-index:99999;right:12px;top:12px;width:390px;max-height:80vh;overflow:auto;background:#121619ee;color:#e7efe9;border:1px solid #67796b;padding:16px;font:12px/1.55 monospace';
  panel.innerHTML='<strong>APAGÃO · Verificação de áudio</strong><p><button id="runAudioQa">Executar verificação</button></p><pre id="audioQaResult" style="white-space:pre-wrap">Aguardando execução.</pre>';
  document.body.append(panel);
  panel.querySelector('button').onclick=async()=>{
    const output=panel.querySelector('pre');const lines=[];
    const report=(line)=>{lines.push(line);output.textContent=lines.join('\n');};
    const check=(condition,label)=>{if(!condition)throw new Error(label);report('PASS '+label);};
    const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
    try {
      await import('../test/pointerlock-mock.js');window.PLM.activeUntil=performance.now()+120000;
      await game.start(false,'hardcore');game.freezeAI=true;
      await game.audio.resume();await game.audio.library.loaded;
      const lib=game.audio.library,ctx=game.audio.ctx;
      check(lib.stats.manifest==='complete','pacote ElevenLabs completo');
      // Decodifica todos os masters do pacote usando o decodificador do navegador.
      for(const id of Object.keys(lib.entries)) await lib.ensure(id);
      check(lib.failed.size===0,'todos os arquivos decodificados pelo navegador');
      const files=Object.values(lib.entries).reduce((n,list)=>n+list.length,0);
      report('Arquivos decodificados: '+files);
      const {verifySpatial}=await import('./spatial-qa.js');
      await verifySpatial(lib.buffers.get('creature_step')[0],check,report);
      const creature=lib.buffers.get('creature_step')[0];
      check(creature.numberOfChannels===1,'passos mono para posição 3D');
      const oldPlayed=lib.stats.played;
      for(const material of ['lino','tile','stone','concrete','brick','asphalt','wood','water'])game.audio.footstep(material,0.65);
      check(lib.stats.played===oldPlayed+8,'oito pisos reproduzem sons próprios');
      const voice=[...lib.voices].at(-1);
      const clear=game.grid.segmentClear;
      try {
        game.grid.segmentClear=()=>false;await wait(90);lib.updateSpatial();await wait(180);
        check(voice.route.occluded&&voice.route.filter.frequency.value<3000,'oclusão atualiza durante o passo');
        game.grid.segmentClear=()=>true;lib.updateSpatial();await wait(180);
        check(!voice.route.occluded&&voice.route.filter.frequency.value>10000,'abrir passagem remove o abafamento');
      } finally { game.grid.segmentClear=clear; }
      const analyser=ctx.createAnalyser();analyser.fftSize=2048;game.audio.master.connect(analyser);
      const samples=new Float32Array(analyser.fftSize);
      const measure=()=>{analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length);};
      const tick=(dt,state)=>lib.update(dt,{zone:{level:0},fear:0,monsterDist:Infinity,...state});
      game.state='playing';game.director.finale=false;game.ai.enraged=false;game.ai.state='patrol';
      tick(3);await wait(1700);
      check(lib.stats.music==='score_explore','trilha de exploração');
      game.audio.footstep('lino',0.9);game.audio.click(true);await wait(80);
      const rms=measure();check(Number.isFinite(rms)&&rms>0.00001,'sinal real na saída WebAudio');report('RMS da saída: '+rms.toFixed(6));
      tick(3,{zone:{level:-1}});tick(3,{zone:{level:-1}});
      check(lib.stats.music==='score_basement'&&lib.stats.ambience==='amb_basement','subsolo');
      game.ai.state='chase';tick(0.1,{fear:0.9,monsterDist:6});
      check(lib.stats.music==='score_chase','perseguição imediata');
      const spot=game.world.hideSpots.find(s=>s.type==='locker');
      game.player.hidden=spot;game.player.holdingBreath=true;
      tick(3,{fear:0.8,monsterDist:6});tick(3,{fear:0.8,monsterDist:6});
      check(lib.stats.music==='score_stalk'&&lib.loops.get('score_stalk').target<0.2,'esconderijo reduz a trilha');
      check((lib.loops.get('breath_calm')?.target||0)===0&&(lib.loops.get('breath_panic')?.target||0)===0,'prender respiração silencia os loops');
      game.player.hidden=null;game.player.holdingBreath=false;game.ai.state='patrol';game.director.finale=true;
      tick(3);tick(3);check(lib.stats.music==='score_finale','trilha do final');
      game.audio.startSiren();check(lib.loops.get('siren')?.target>0,'alarme gerado');game.audio.stopSiren();check(lib.loops.get('siren')?.target===0,'alarme para');
      game.audio.creatureCry(game.ai.pos,'growl');check(lib.duckUntil>ctx.currentTime,'pistas reduzem temporariamente a música');
      game.state='dying';game.audio.death();tick(0.1);check(lib.musicId===null,'morte interrompe a trilha');
      game.state='won';tick(0.1);check(lib.stats.music==='score_escape'&&lib.loops.get('score_escape')?.once,'fuga toca uma vez');
      game.state='playing';game.director.finale=false;lib.reset();
      game.pause('menu');await wait(100);check(ctx.state==='suspended','pausa solo suspende o áudio');
      await game.audio.resume();game.state='playing';document.getElementById('pause').hidden=true;
      await lib.ensure('score_explore');
      game.online={players:new Map(),me:0,update(){}};game.state='paused';tick(3);tick(3);check(lib.musicId!==null,'menu cooperativo conserva o áudio');
      game.online=null;game.state='playing';lib.reset();
      const before=lib.stats.played;
      game.audio.footstep('concrete',0.65,{x:game.camera.position.x+2,y:game.player.pos.y,z:game.camera.position.z});
      game.audio.whisper(game.camera.position);game.audio.drawer(game.camera.position);game.audio.lampBurst(game.camera.position);
      check(lib.stats.played>=before+4,'eventos e passos posicionais usam masters');
      check(lib.stats.activeVoices<=24,'limite de vozes');
      await wait(900);check(measure()>0.00001,'mixagem continua audível após transições');
      report('AUDIO_BROWSER_VERIFIED');
      panel.dataset.status='passed';
      analyser.disconnect();game.audio.master.disconnect(analyser);
      game.audio.reset();game.state='paused';game.audio.suspend();
    } catch(error) { report('FAIL '+error.message);panel.dataset.status='failed';game.online=null;game.state='paused';game.audio?.suspend();console.error(error); }
  };
}
