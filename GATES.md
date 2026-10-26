# Gates: trilha sonora ElevenLabs do APAGÃO

OWNS: src/core/audio.js, src/core/audio-library.js, src/main.js, assets/audio/**, tools/audio/**, tools/test/audio-test.mjs, tools/serve.py, .gitignore, .env.example, docs/AUDIO.md, LEIA-ME.md, package.json

Scope: substituir a trilha e os efeitos por áudio gerado no ElevenLabs, com mixagem dinâmica e reprodução espacial, sem expor a chave.

- [x] G1: todos os sons do catálogo possuem arquivos ElevenLabs válidos e medidos
  CHECK: node tools/audio/verify.mjs
  EXPECT: AUDIO_ASSETS_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=62b6eb6a56ebd4d81ca2c239095eef836abf169e31622fe41cfd91918572bb9f; exit=0; EXPECT=matched; output-sha256=172f0600eb8e16f043ddf72b5e21faa2a4f1602dd83082d7216e237dda3a633d; output-bytes=101; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] G2: reprodução, transições, limites de vozes e compatibilidade com áudio ausente funcionam
  CHECK: node tools/test/audio-test.mjs
  EXPECT: AUDIO_RUNTIME_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2a1c7f96d76a1272187e9c176580834ac00b7f29a431f1afe4bffa4b819376d2; exit=0; EXPECT=matched; output-sha256=c2e66e4075d9d4b253d8aee717a7da7e3944c07933144d7f494e1db20df9a242; output-bytes=114; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [x] G3: a geração valida credenciais, retoma arquivos existentes e não publica segredos
  CHECK: node tools/audio/check-pipeline.mjs
  EXPECT: AUDIO_PIPELINE_VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5550516155f47c02771eebb4ff673f5bb2e489402d078d7dac00e0c670d21dc7; exit=0; EXPECT=matched; output-sha256=f79b934d6c68217c150d68e75b23b0b76bfbe786c54759b0c1156f815a95de9f; output-bytes=141; shell=C:\Users\WillianIA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe; cwd=C:\Users\WillianIA\Videos\Jogo de terror opus 5;5 online; path=8dcfab159bfd/52 entries

- [ ] G4: a experiência sonora real foi revisada no jogo, incluindo perseguição, esconderijo, morte e fuga
  EVIDENCE: pending

- [x] G5: o jogo real decodifica todo o pacote e reproduz os cenários sem falha na saída WebAudio
  EVIDENCE: IAB, /index.html?debug&audioqa: AUDIO_BROWSER_VERIFIED; 82 arquivos decodificados; RMS de saída 0.051276; exploração, subsolo, perseguição, esconderijo, respiração, final, alarme, morte, fuga, pausas solo/coop, eventos e limite de vozes passaram. Captura em tools/audio/qa-screen.png. O catálogo também reproduziu score_explore.ogg, readyState=4 e error=null, e alternou step_tile_1/step_tile_2. Captura do catálogo em tools/audio/catalog-screen.png.

ABANDON: G4 a interface desta sessão rejeita entrada de áudio (audio content omitted because you do not support audio input); a escuta artística não pode ser atestada pelo assistente. O pacote foi gerado, integrado e verificado tecnicamente; o catálogo tools/audio/index.html permite a escuta pelo usuário.

Status externo: credencial válida aceita no plano Creator. Pacote ElevenLabs completo com 82 arquivos; a chave está apenas no .env local, protegido pelo servidor e excluído do Git.
