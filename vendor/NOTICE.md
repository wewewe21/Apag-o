# Créditos e licenças de terceiros

O jogo em si (pasta `src/`, `server/`, `assets/`, `tools/`) é do autor do projeto. Estes componentes de terceiros são usados
pelo recurso **eco de voz** (a criatura imitando a voz de quem autorizou) e pelo jogo em geral:

| Componente | Uso | Licença |
|---|---|---|
| [three.js 0.170](https://github.com/mrdoob/three.js) | gráficos 3D (carregado por `importmap`; no build vai para `dist/vendor/three/`) | MIT |
| [ws](https://github.com/websockets/ws) | WebSocket do servidor | MIT |
| [ONNX Runtime Web 1.18.0](https://github.com/microsoft/onnxruntime) | executa o modelo de voz no navegador (`ort.min.js` + `ort-wasm-simd.wasm`; no build vão para `dist/vendor/ort/`) | MIT (© Microsoft) |
| `vendor/sentencepiece.js` | tokenizador SentencePiece compilado para WebAssembly (build clássico do projeto [pocket-voice](https://github.com/hemanth/pocket-voice), MIT) | SentencePiece: Apache-2.0 (© Google); embrulho: MIT |
| [Pocket TTS](https://huggingface.co/kyutai/pocket-tts) (Kyutai) | modelo de síntese de voz que gera as falas novas na voz da amostra | **CC-BY-4.0**, com cláusula de uso: não clonar a voz de alguém sem o consentimento da pessoa |
| Exportação ONNX int8 do Pocket TTS por [KevinAHM](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) | os arquivos `.onnx` baixados pelo navegador (não fazem parte deste repositório) | Apache-2.0 (código) / CC-BY-4.0 (pesos) |
| Adaptação do worker (`src/voice/mimic/pocket-worker.js`) | baseada em [pocket-tts-web](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) e [pocket-voice](https://github.com/hemanth/pocket-voice) | Apache-2.0 / MIT |

## Atribuição exigida pela CC-BY-4.0

> Modelo de voz: **Pocket TTS**, de **Kyutai** (https://huggingface.co/kyutai/pocket-tts), licença Creative Commons Attribution 4.0
> (https://creativecommons.org/licenses/by/4.0/). Conversão para ONNX/int8 por KevinAHM. O modelo é usado sem alterações de pesos
> além da quantização feita na exportação.

O jogo mostra o crédito na janela de consentimento do eco de voz.

## Como o consentimento se liga à licença

A licença do modelo proíbe imitar a voz de uma pessoa sem o consentimento dela. Por isso o jogo:

1. só usa **a amostra gravada na hora pelo próprio jogador**, depois de um botão de autorização específico (a permissão do microfone
   do chat de voz não vale);
2. processa a amostra **somente no navegador dele** e a descarta em seguida;
3. envia à sala apenas 5 frases curtas já geradas, que somem ao fim da partida, ao sair ou ao revogar.

## Os modelos NÃO ficam no repositório

Os arquivos `.onnx` (~146 MB) são baixados pelo navegador do jogador **só quando ele autoriza o eco de voz**, direto do Hugging Face,
e ficam no cache do navegador. Para hospedar você mesmo, veja `docs/PUBLICAR.md` (variável `mimicModelBase` em `runtime-config.js`).
