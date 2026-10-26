import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { api, parseEnv, requireKey, main, bodyFor, probe, ROOT } from './generate.mjs';
import { CATALOG, filenames } from './catalog.mjs';

assert.equal(new Set(CATALOG.map(a=>a.id)).size,CATALOG.length);
assert.equal(new Set(CATALOG.flatMap(filenames)).size,CATALOG.flatMap(filenames).length);
assert.ok(CATALOG.every(a=>a.type==='music' ? a.seconds>=3 && a.seconds<=600 : a.seconds>=0.5 && a.seconds<=30));
assert.ok(CATALOG.every(a=>a.prompt.length>80 && a.prompt.length<4100));
for(const a of CATALOG)for(let i=0;i<a.variants;i++)assert.ok(a.type==='music'||bodyFor(a,i).text.length<=450,'limite real dos prompts da API de efeitos');
assert.throws(()=>bodyFor({id:'too_long',type:'foley',prompt:'x'.repeat(451),variants:1},0),/450/);
assert.throws(()=>requireKey('key_identifier_fixture'),/sk_/);
assert.throws(()=>requireKey(''),/sk_/);
const fixtureKey='sk_test_fixture_no_real_credentials';
assert.equal(parseEnv('OTHER=1\nELEVENLABS_API_KEY="'+fixtureKey+'"\n'),fixtureKey);
let attempts=0;
await assert.rejects(api('sound-generation',fixtureKey,{},async()=>{attempts++;return new Response(JSON.stringify({detail:{code:'invalid_api_key',message:fixtureKey}}),{status:400});}),e=>!e.message.includes(fixtureKey)&&e.message.includes('[redacted]'));
assert.equal(attempts,1,'credencial inválida não é repetida');
attempts=0;
await assert.rejects(api('sound-generation',fixtureKey,{},async()=>{attempts++;throw new Error('transport failure');}),/transport failure/);
assert.equal(attempts,1,'resultado cobrado desconhecido não provoca nova geração');
const privatePattern=/sk_[A-Za-z0-9_-]{28,}|(?:xi-api-key|ELEVENLABS_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9]{32,}/;
assert.ok(privatePattern.test('sk_'+'x'.repeat(40)),'controle positivo da detecção de segredos');
for(const relative of ['src/core/audio.js','src/core/audio-library.js','tools/audio/catalog.mjs','tools/audio/generate.mjs','assets/audio/manifest.json','docs/AUDIO.md']) {
  const text=await readFile(path.join(ROOT,relative),'utf8');
  assert.ok(!privatePattern.test(text),relative+': segredo encontrado');
  if(relative.startsWith('src/')) assert.ok(!/api\.elevenlabs\.io|ELEVENLABS_API_KEY/.test(text),relative+': credencial/API no cliente');
}

// Fixtures sintéticas só em diretório temporário; nenhuma entra no jogo.
const temporary = await mkdtemp(path.join(tmpdir(),'apagao-audio-check-'));
let child;
try {
  const raw=path.join(temporary,'fixture.mp3');
  const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=700:duration=0.5','-c:a','libmp3lame','-b:a','192k',raw],{encoding:'utf8',windowsHide:true});
  assert.equal(ff.status,0,ff.stderr);
  const bytes=await readFile(raw);let generations=0;
  const request=async(url,opts)=>{
    assert.equal(opts.headers['xi-api-key'],fixtureKey);
    if(url.endsWith('user/subscription')) return new Response(JSON.stringify({tier:'creator',character_count:0,character_limit:1000}));
    assert.ok(url.startsWith('https://api.elevenlabs.io/v1/sound-generation?'));
    const body=JSON.parse(opts.body);assert.equal(body.model_id,'eleven_text_to_sound_v2');
    generations++;return new Response(bytes,{headers:{'content-type':'audio/mpeg'}});
  };
  const outputDir=path.join(temporary,'output');
  const dependencies={key:fixtureKey,request,outputDir,log:()=>{}};
  await main(['--only=click_on'],dependencies);
  assert.equal(generations,1);
  const manifest=JSON.parse(await readFile(path.join(outputDir,'manifest.json'),'utf8'));
  assert.ok(manifest.assets.click_on[0].duration>0.1);
  assert.ok(!(await readFile(path.join(outputDir,'manifest.json'),'utf8')).includes(fixtureKey));
  await main(['--only=click_on'],dependencies);assert.equal(generations,1,'retomada não cobra novamente');
  await unlink(path.join(outputDir,'click_on.ogg'));
  await main(['--only=click_on'],dependencies);assert.equal(generations,1,'master existente repara arquivo sem cobrança');
  await main(['--only=step_lino'],dependencies);
  assert.equal(generations,7,'seis tomadas de Foley');
  const foleyManifest=JSON.parse(await readFile(path.join(outputDir,'manifest.json'),'utf8'));
  for(const e of foleyManifest.assets.step_lino) {
    assert.equal(e.channels,1);assert.equal(e.targetLufs,-28);
    assert.equal(probe(path.join(outputDir,e.file)).streams[0].channels,1,'master stereo convertido para HRTF mono');
  }
  await writeFile(path.join(temporary,'.env'),'ELEVENLABS_API_KEY='+fixtureKey);
  await writeFile(path.join(temporary,'public.txt'),'public fixture');
  const python='import http.server, importlib.util, functools, sys; spec=importlib.util.spec_from_file_location("audio_serve",sys.argv[1]); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); server=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(mod.NoCache,directory=sys.argv[2])); print(server.server_address[1],flush=True); server.serve_forever()';
  child=spawn('python',['-c',python,path.join(ROOT,'tools','serve.py'),temporary],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('servidor não iniciou')),10000);let errors='';child.stderr.on('data',data=>{errors+=String(data);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('servidor encerrou '+code+': '+errors.slice(-1000)));});child.once('error',e=>{clearTimeout(timer);reject(e);});child.stdout.once('data',data=>{clearTimeout(timer);resolve(Number(String(data).trim()));});});
  assert.ok(port>0);
  const base='http://127.0.0.1:'+port;
  for(const file of ['/.env','/%2eenv','/.claude/settings.json','/assets/audio/source/master.mp3']) {
    assert.equal((await fetch(base+file)).status,404,file);
    assert.equal((await fetch(base+file,{method:'HEAD'})).status,404,file+' HEAD');
  }
  assert.equal(await (await fetch(base+'/public.txt')).text(),'public fixture');
} finally {
  if(child) { child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r)); }
  await rm(temporary,{recursive:true,force:true});
}
console.log('AUDIO_PIPELINE_VERIFIED: parâmetros, autenticação, sem repetição de cobranças, normalização, retomada e proteção HTTP de segredos.');
