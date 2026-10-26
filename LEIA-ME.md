# APAGÃO — Hospital-Colônia Santa Lúcia

Terror em primeira pessoa. Encontre os 5 fusíveis, religue a trava da porta principal e fuja do Noturno.
Protótipo jogável completo em three.js (navegador), com animações da criatura geradas pelo **kimodo.cpp** desta pasta.

Documento de design completo: [docs/GDD.md](docs/GDD.md)

Trilha e efeitos gerados com ElevenLabs: [docs/AUDIO.md](docs/AUDIO.md). São 6 trilhas e 115 arquivos de efeitos/ambientes, incluindo 54 novos passos com oito materiais e HRTF para fones. Para ouvir cada som e comparar os passos em 3D: `http://localhost:8765/tools/audio/` com o servidor ativo.

## Como jogar

1. Dê dois cliques em **`iniciar.bat`** (precisa de Python 3). O navegador abre em `http://localhost:8765`.
   - Ou, no terminal: `python tools/serve.py`
   - Não abra o `index.html` direto (file://): módulos ES e o `fetch` das animações precisam de um servidor.
2. Clique em **Entrar**. Use fones de ouvido.

| Tecla | Ação |
|---|---|
| W A S D | andar |
| Shift | correr (faz barulho, cansa) |
| C | agachar (quase silencioso) |
| F | lanterna liga/desliga |
| Botão direito (segurar) | foco: queima os olhos dele — mire no rosto |
| E | interagir / esconder-se / sair |
| Espaço (escondido) | prender a respiração |
| R | bater a lanterna (bateria fraca) |
| Tab | objetivo atual |
| M | planta do prédio (depois de pegá-la na recepção) |
| Esc | pausa e opções (sensibilidade, volume, qualidade, inverter Y) |

Dicas: fusíveis no bolso se perdem se você morrer — instale-os no quadro geral (salva o progresso). Luz forte faz a criatura hesitar. Se ela te vir entrando no esconderijo, não adianta.

## Estrutura

```
index.html            telas + HUD
src/main.js           jogo (estados, interação, objetivos, morte, checkpoint)
src/config.js         balanceamento (todos os números)
src/world/            planta, grid (colisão/visão/A*/som), geometria, texturas, props, portas, luz
src/entities/         jogador, lanterna, criatura (modelo+animação), IA, diretor de tensão
src/core/             áudio procedural, entrada, save
src/fx/, src/ui/      pós-processamento, partículas, HUD, documentos
assets/anim/          animações da criatura (Kimodo)
tools/                geração de animações, preview, testes, servidor
```

## Animações da criatura com Kimodo

```powershell
.\tools\gerar_animacoes.ps1              # gera todos os clipes (2 seeds cada, ~20 s por clipe na GPU)
.\tools\gerar_animacoes.ps1 -Only run    # só um clipe
python tools\kimodo_to_game.py --all     # empacota todas as seeds para comparar
# abra http://localhost:8765/tools/preview/index.html?only=run,walk
python tools\kimodo_to_game.py           # empacota as seeds escolhidas (CHOICE no script) em assets/anim/creature.json
```

Para criar um movimento novo: adicione uma linha em `$clips` no `gerar_animacoes.ps1` (nome, quadros a 30 fps, seeds, prompt em inglês), marque o tipo em `CLIP_KIND` no `kimodo_to_game.py` e use `this.m.play('nome')` na IA.

## Testes e depuração

- `node tools/test_layout.mjs` — planta: tudo alcançável, portas válidas, A*, linha de visão, colisão, escada.
- Abra `http://localhost:8765/index.html?debug&autostart` e, no console do navegador:
  - `await dbg.flowTest()` — joga o fluxo inteiro (5 fusíveis, gaveta 13, chave, quadro, alavanca, carga, saída) e devolve o log.
  - `dbg.tp(x, z)` teleporta (em células), `dbg.lights()` liga todas as luzes, `dbg.creature(x, z, yaw, 'stalk')` posiciona a criatura, `dbg.sim(segundos)` simula sem renderizar, `dbg.status()`.
- **F3** no jogo mostra FPS, estado da criatura, medidor de detecção, tensão do diretor, bateria e calor.

## Online, voz e publicação

- Cooperativo online (até 4 jogadores, 7 fusíveis, uma vida cada), chat de voz por proximidade e "eco de voz" opcional: veja [docs/PUBLICAR.md](docs/PUBLICAR.md) para publicar o cliente no GitHub Pages e o servidor no Render gratuito.
- Servidor local: `npm ci` e `npm start` (porta 8080). Cliente: `python tools/serve.py` ou `npm run build:client` (gera `dist/`).
- `npm test` roda todos os testes automáticos sem navegador. Créditos de terceiros: [vendor/NOTICE.md](vendor/NOTICE.md).
- Modos solo: **Normal** (salva ao instalar fusível e mantém os instalados após morrer) e **Hardcore** (morreu, recomeça do zero, sem checkpoints; não apaga o save do Normal).

## Criatura

Movimento, colisao, percepcao e animacao do Noturno: [docs/CRIATURA.md](docs/CRIATURA.md).
