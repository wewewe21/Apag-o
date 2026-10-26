# Gates: passos naturais e áudio espacial

OWNS: src/core/audio.js, src/core/audio-library.js, src/core/footsteps.js, src/entities/player.js, src/net/remote.js, src/world/layout.js, src/world/textures.js, assets/audio/**, tools/audio/**, tools/test/audio-test.mjs, tools/test/footsteps-test.mjs, docs/AUDIO.md, LEIA-ME.md, package.json, dist/**, server/worldspec.json

Scope: refazer os passos com ElevenLabs, oito materiais com variações, jogador mais baixo, inimigo em destaque e HRTF com oclusão atualizada para fones.

- [x] F1: todos os passos novos são masters ElevenLabs válidos e o pacote completo decodifica sem clipping
  CHECK: node tools/audio/verify.mjs
  EXPECT: AUDIO_ASSETS_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=62b6eb6a56ebd4d81ca2c239095eef836abf169e31622fe41cfd91918572bb9f; exit=0; EXPECT=matched; output-sha256=d1f0ab75b75511674a6aef271a67171f8df4400001ce93fba98ef745815b8e2b; output-bytes=102; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] F2: superfícies reais, água cooperativa, variações, ganho e oclusão dinâmica obedecem aos cenários de teste
  CHECK: node tools/test/footsteps-test.mjs
  EXPECT: FOOTSTEPS_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b7ce711f7c1bdad85d715d928fb013f9fb0a87a7b3e61e623101874fd81632f1; exit=0; EXPECT=matched; output-sha256=d78d12ddd5e717079a885a937adca0bdac3112f04be7a60b795e6e6fae5f0ffe; output-bytes=132; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] F3: música, efeitos existentes e limites de reprodução continuam funcionando
  CHECK: node tools/test/audio-test.mjs
  EXPECT: AUDIO_RUNTIME_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2a1c7f96d76a1272187e9c176580834ac00b7f29a431f1afe4bffa4b819376d2; exit=0; EXPECT=matched; output-sha256=c2e66e4075d9d4b253d8aee717a7da7e3944c07933144d7f494e1db20df9a242; output-bytes=114; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] F4: cliente distribuível incorpora os sons e materiais sem publicar segredos
  CHECK: npm run build
  EXPECT: [build] ok:
  EVIDENCE: automatic-evidence=v1; definition-sha256=1938ac125fa0672e8a5979fd3b5dcdd07dfabf0cd1d2945257b55416ee217f87; exit=0; EXPECT=matched; output-sha256=f903d161febe7744384c234bf4c6e72bb19a5ca947d17c327db42d6d5771612b; output-bytes=406; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] F5: o navegador real mede direção esquerda/direita, frente/atrás, distância e oclusão com os novos passos
  EVIDENCE: IAB em /index.html?debug&audioqa, AUDIO_BROWSER_VERIFIED. 121 arquivos decodificados. Roteamento HRTF real: canal direito 2,13x o esquerdo; distância 0,20x e parede 0,32x a referência. Rotação da cabeça, diferença frente/trás, oito materiais, oclusão dinâmica e transições do jogo passaram. RMS final medido 0,048853. Captura tools/audio/footsteps-qa.png.

- [ ] F6: naturalidade dos novos sons foi avaliada por audição com fones
  EVIDENCE: pending

ABANDON: F6 esta sessão não admite entrada de áudio; o assistente não pode atestar uma escuta artística. O catálogo permitirá ao usuário ouvir as novas variações e a localização em 3D.
