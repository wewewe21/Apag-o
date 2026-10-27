// Roda os testes AUTOMATICOS que nao precisam de navegador: npm test
//   - layout do mapa (tools/test_layout.mjs, rodado antes pelo npm)
//   - servidor: partida, fusiveis, morte/espirito, reconexao, voz (sinalizacao), eco de voz
//   - build do cliente (caminhos relativos, sem segredos) e servidor de arquivos da pasta dist
//   - audio (catalogo)
// Testes que EXIGEM navegador (Pointer Lock, WebRTC real, modelo de voz, microfone) estao em tools/test/*.js e docs/PUBLICAR.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const steps = [
  ['servidor: partida e regras (49)', ['tools/test/server-test.mjs']],
  ['servidor: morte, espirito, voz, reconexao (80)', ['tools/test/server-test2.mjs']],
  ['servidor: eco de voz (opt-in, limites, descarte)', ['tools/test/mimic-server-test.mjs']],
  ['criatura: colisao, movimento, percepcao, escuta', ['tools/test/creature-server-test.mjs']],
  ['espirito: atravessa paredes, nao sai do predio', ['tools/test/ghost-walls-test.mjs']],
  ['salas: 4 jogam, 10 na sala, espectadores, fila', ['tools/test/rooms-spectators-test.mjs']],
  ['teclas configuraveis: padroes, troca, conflito, guardar', ['tools/test/keybinds-test.mjs']],
  ['cena de morte: roteiro, camera, reset', ['tools/test/death-scene-test.mjs']],
  ['criatura: bracos retos e caidos parada (esqueleto real)', ['tools/test/creature-pose-test.mjs']],
  ['modelos 3D: normalizacao, mundo identico, process.py, executor Tripo (servidor falso)', ['tools/test/models-test.mjs']],
  ['servidor: hospedagem (PORT, /health, CORS, origem)', ['tools/test/hosting-test.mjs']],
  ['cliente: build estatico sem segredos, caminhos relativos', ['tools/test/build-test.mjs']],
];
if (fs.existsSync(path.join(ROOT, 'tools/test/audio-test.mjs'))) steps.push(['audio: catalogo e limites', ['tools/test/audio-test.mjs']]);

let failed = 0;
for (const [name, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const last = out.trim().split('\n').filter(l => /Resultado|ok|verified|VERIFIED|falha/i.test(l)).slice(-1)[0] || out.trim().split('\n').slice(-1)[0] || '';
  const good = r.status === 0;
  if (!good) failed++;
  console.log(`${good ? 'PASSOU ' : 'FALHOU '} ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)  ${last.trim()}`);
  if (!good) console.log(out.split('\n').filter(l => /FALHA|EXCE|Error|erro/i.test(l)).slice(0, 12).join('\n'));
}
console.log(failed ? `\n${failed} etapa(s) falharam.` : '\nTodas as etapas automaticas passaram.');
process.exit(failed ? 1 : 0);
