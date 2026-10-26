# Plano de implementação e status

Ordem definida no pedido (`prompt_melhorias_jogo_terror.txt`). Cada etapa é testada antes da próxima.

| # | Etapa | Status |
|---|-------|--------|
| 1 | Diagnóstico e execução inicial | feito — jogo roda, `test_layout.mjs` e `dbg.flowTest()` passam (5 fusíveis no solo) |
| 2 | Mouse (Pointer Lock) e visão pelas frestas do armário | feito |
| 3 | Batimento cardíaco por proximidade e reação da criatura à luz | feito |
| 4 | Normal / Hardcore e isolamento de saves | feito |
| 5 | Servidor, salas e sincronização cooperativa | feito (servidor: 129 checagens automáticas; cliente: partida completa testada no navegador com robô) |
| 6 | Fusíveis, reunião final, morte, espectadores, desconexões | feito (mesmos testes) |
| 7 | Chat de voz e filtro de rádio | feito e testado com microfone SINTÉTICO (laço na mesma página); microfone real e redes diferentes NÃO testados |
| 8 | Imitação de voz da criatura | feito (clonagem local Pocket TTS, opt-in específico); nunca testado com voz humana real |
| 9 | Integração, desempenho, publicação | build, testes automáticos (`npm test`) e guia `docs/PUBLICAR.md` prontos; publicação é feita por você |

## Achados do diagnóstico (etapa 1)

- Engine: three.js 0.170 (ES modules, importmap via CDN), sem bundler. Servidor local: `python tools/serve.py`.
- Solo tem **5** fusíveis (`FUSES_TOTAL = 5`, lore também diz "cinco"). O pedido menciona "quatro"; mantive os 5 atuais, sem alterar o solo.
- kimodo.cpp real: `C:\Users\WillianIA\Documents\jogo claude\kimodo.cpp` (kmd-generate.exe + modelos GGUF, GPU RTX 5060 Ti). O caminho relativo antigo em `tools/gerar_animacoes.ps1` não existia nesta pasta.
- `g.fx?.smokeBurst` (fumaça ao queimar a criatura) chamava um objeto que nunca existiu: a fumaça nunca aparecia.

## Etapa 2 — o que estava errado

Mouse: `pointerlockerror` ligava `dragLook = true` para sempre. Qualquer erro passageiro (Esc seguido de outro pedido, gesto do usuário expirado após uma carga longa, aba sem foco) desligava o Pointer Lock até recarregar.

Armário: (1) a câmera olhava para a **parede do fundo** (yaw `spot.yaw` sem `+π`), (2) a porta era uma caixa maciça: as "frestas" eram decalques e uma máscara de pós-processamento, (3) a câmera ficava em 1,55 m, abaixo das frestas, sob uma prateleira em 1,59 m, (4) a lanterna acesa dentro do armário batia na porta por dentro e ofuscava.

## Etapas 7 a 9 — resumo honesto

- **Automatizado (`npm test`)**: layout, servidor (49 + 80 checagens), eco de voz no servidor (36), hospedagem/CORS/origem (27), build estático em subpasta e sem segredos (31), catálogo de áudio.
- **Automatizado no navegador (manual de rodar)**: `tools/test/voice-tests.js` (filtro de rádio, WebRTC em laço com mic sintético), `tools/test/mimic-tests.js` (efeito sombrio, funil do modelo local, inteligibilidade medida com Whisper só em teste), `mode-tests.js`, `browser-online.js`.
- **Clonagem de voz**: real (gera frases novas na voz da amostra, modelo local Kyutai Pocket TTS, CC-BY-4.0). Não é reprodução da gravação com efeito. A amostra usada nos testes foi sintética: semelhança e naturalidade com voz humana real ainda precisam ser ouvidas por você.
- **Não verificado por mim**: microfone real, conexão entre redes diferentes (TURN), latência real no Render gratuito.
- **Efeito sombrio (medido com Whisper-base em 12 clipes fixos, amostra sintética)**: fala gerada sem efeito 5/12 frases reconhecidas; com o efeito escolhido (`DARK` em `src/voice/mimic/mimic.js`) 6/12; versões mais leves 5/12 e 6/12. Ou seja, o efeito não piorou o reconhecimento por esta medida (a diferença é ruído do sorteio). Uma primeira rodada com clipes diferentes tinha dado 6/10 contra 3/10: a medida é ruidosa com poucos clipes. O limite real é a própria fala gerada a partir da amostra sintética; com voz humana o reconhecimento deve ser melhor, mas isso não foi verificado.
