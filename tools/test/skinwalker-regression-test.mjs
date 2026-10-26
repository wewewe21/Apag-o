// Execute unchanged game/server/audio regression oracles, using one fixed
// random stream for reproducible AI paths rather than retrying until success.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const steps=[['layout','tools/test_layout.mjs'],['server49','tools/test/server-test.mjs'],['server80','tools/test/server-test2.mjs'],['voice36','tools/test/mimic-server-test.mjs'],['creature23 seed42','tools/test/guardian-ai-replay.mjs',['42']],['hosting27','tools/test/hosting-test.mjs'],['build31','tools/test/build-test.mjs'],['audio','tools/test/audio-test.mjs'],['footsteps','tools/test/footsteps-test.mjs'],['haunting','tools/test/haunting-test.mjs'],['children','tools/test/child-ward-test.mjs'],['paranoia','tools/test/paranoia-test.mjs']];
const logs=[];
for(const[name,file,args=[]]of steps){const r=spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:240000});const out=(r.stdout??'')+(r.stderr??'');logs.push(name+'\n'+out);fs.writeFileSync('.unlazy/skinwalker/regression-result.txt',logs.join('\n'));assert.equal(r.status,0,name+'\n'+out);console.log('PASS '+name);}
console.log('SKINWALKER_REGRESSION_VERIFIED');
