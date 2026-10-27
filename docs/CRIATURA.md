# O Noturno: movimento, colisao e percepcao (melhorias)

Tudo abaixo vale para o solo e para o cooperativo (o servidor roda a MESMA IA, `src/entities/creatureAI.js`).
Numeros ajustaveis: `src/config.js` > `CREATURE`.

## O que estava errado (medido, nao suposto)
- `follow()` movia a criatura em linha reta para o proximo ponto **sem nenhuma colisao**: so as celulas do mapa eram consultadas. Cabeca e corpo entravam em paredes, portas e armarios. A cabeca fica 0,55-0,99 m a frente do pivo (medido no modelo real) e ficou ate 0,39 m dentro dos armarios ao farejar.
- Girava com suavizacao exponencial enquanto andava a velocidade cheia: o corpo "escorregava de lado" nas curvas.
- O clipe vinha da velocidade *pedida*, com limites de ritmo estreitos e sem histerese; a patrulha usava `limp` (que arrasta a perna).
- Percepcao: cone binario, igual parado ou andando, tempo dependente da luz de forma pouco previsivel.

## O que mudou
- **Colisao**: corpo (circulo r=0,38) contra tudo e cabeca (circulo r=0,22 a frente, alcance por clipe em `CREATURE.headReach`) contra paredes/moveis altos, todo quadro. A celula so e "andavel" para a criatura se o corpo cabe no centro (`Grid.bodyBlocked`), e atalhos do caminho nao passam por dentro de moveis. Se travar, pula o ponto, refaz o caminho ou recentra (`unstick`). Ao farejar armarios ela para longe o bastante para a cabeca nao entrar (`inspectStand`).
- **Giro**: velocidade angular limitada (`CREATURE.turnRate`) e ela anda mais devagar enquanto ainda esta virando.
- **Animacao**: o clipe e escolhido pela velocidade real no chao (suavizada), com histerese, e o ritmo dos passos e ajustado para os pes nao deslizarem. Marcha lenta nova gerada no **Kimodo** (`creep`, ~0,9 m/s, passos normais) no lugar do `limp` na patrulha. Os 12 clipes antigos ficaram bit a bit iguais.
- **Percepcao v2** (deterministica): visao central (~57 graus) e periferica (ate ~80 graus, mais fraca), direcao do olhar acompanha quem ela ja notou, sensibilidade a movimento (parado x0,6), agachado x0,55, correr x1,25, lanterna e luz no rosto denunciam, cobertura parcial (so o corpo visivel x0,6), **sensor de proximidade** de 2,4 m sem precisar olhar (nao atravessa parede), memoria curta (nao "esquece" numa piscada), e ao perder o jogador correndo ela procura um pouco **a frente** da direcao dele.
- **Escuta**: ao ouvir um barulho ela para, vira o rosto para ele e so entao vai (da ao jogador um aviso); barulhos seguidos so trocam o destino.

## Medidas (antes -> depois)
Colisao no jogo, 168 s de cenarios variados: corpo em parede 0 -> 0 %; cabeca em parede 14,7 % dos quadros da patrulha (max 0,12 m) -> 0 %; cabeca em armario ate 0,39 m -> ate 0,06 m. Pes/chao: razao velocidade/passo mediana 1,00 (p10 1,00, p90 <=1,12). Clipe de andar errado <= 2 % dos quadros em movimento. No servidor, 5 min de jogo: 0 penetracoes, 0 travadas longas.
Tempo ate perseguir, de frente, andando, escuro: 3 m 1,6 s; 6 m 1,9 s; 10 m 2,6 s; 16 m 5,7 s (antes 1,6 / 2,7 / 3,8 / 8,7). Com luz: 0,8-1,6 s. Lanterna ligada: 0,4-0,6 s. Agachado e parado a 16 m no escuro: nunca.

## Testes
- `node tools/test/creature-server-test.mjs` (tambem em `npm test`): colisao, travamento, ritmo dos passos, percepcao previsivel/sensata, escuta.
- Navegador (`?debug`): `import('/tools/test/creature-tests.js')` -> `locomotion()`, `hideSpots()`, `detection()`.

## Kimodo (recriar animacoes)
`$env:KIMODO_DIR="C:\Users\WillianIA\Documents\kimodo-ai"; .\tools\gerar_animacoes.ps1 -Only creep` (aceita build Release ou debug), depois `python tools\kimodo_to_game.py` (empacota as seeds de `CHOICE` em `assets/anim/creature.json`; confira o resultado com `--all` e `tools/preview/index.html`). Novos clipes entram no FIM da lista `CLIPS` de `src/net/protocol.js` (o indice vai pela rede).

## Olhar fixo (cabeca travada no jogador quando ela esta ciente)

Quando ela esta CIENTE (espreita, caca, hesita, ataca, ou esta vendo o jogador) a cabeca fica ERGUIDA e TRAVADA nele, sem baixar nem balancar com o passo; em patrulha/busca/fuga sem ter notado, a cabeca fica solta, entao a cabeca ainda avisa que o jogador foi visto (decisao do usuario). `CREATURE.stare.on` em `src/config.js` e o interruptor: `false` (atual) = so ciente; `true` = encara sempre (patrulha, busca e fuga tambem, nao farejando esconderijo, cambaleando ou no duto), ate `range` m. No coop vem de graca: o servidor ja manda o alvo do olhar nos snapshots.
- `CreatureAI.staresAt()` decide; `CreatureModel._aimHead` trava quase 100% (pescoco 50%, cabeca 92%).
- `CreatureModel._aimDirection` impede o defeito do olhar permanente: com ela de costas para o jogador a direcao "exatamente atras" e ambigua e a cabeca pularia de ombro. Limite de ~100 graus para cada lado do corpo (~50 para cima), ombro estavel (so troca depois de o jogador passar bem do outro lado) e velocidade maxima de giro de 8 rad/s.
- Com `stare.on: true` a cabeca deixaria de denunciar se ela ja notou o jogador; por isso o padrao e `false`.

## Pose parada: bracos longos e caidos (nao de zumbi)

Parada (`idle`/`look`, inclusive `hesitate`) ela fica com os bracos RETOS e CAIDOS ao lado do corpo, quase ate os joelhos, e os dedos longos, retos e abertos. Antes o cotovelo ficava dobrado a 84-113 graus com a mao mole para frente (pose de zumbi): `_shapeSkinwalkerArms` (`skinwalker-motion.js`) so podia girar o braco ~26 graus por articulacao. Agora o limite e a forca sobem com `HANG` (1 parada; 0,35 a 0,6 andando/correndo, onde o balanco do clipe continua, so mais reto). Dedos: `skinCurl`/abertura em `guardian-rig.js` para `idle`/`look`. Clipes de acao (`attack`, `roar`, `recoil`, `pain`, `inspect`, `crawl`) nao mudam. Medido no esqueleto real por `tools/test/creature-pose-test.mjs` (esta no `npm test`): cotovelo 11-27 graus parada; mao a 96-99% do braco abaixo do ombro.


## Sem dutos (decisao de 2026-10-26)

A criatura **nao entra em dutos**: ela e grande demais para eles e o estado `vent` causava casos estranhos (entrar num duto mesmo com o lugar protegido pela luz). Respiro do diretor e finale a mandam **andando** pelo chao (e pelas escadas, se a porta do subsolo estiver destrancada). Os pontos de duto continuam no mapa so como cenario e como cantos distantes para o respiro. Tambem: se alguem **encosta** nela (alcance do bote) enquanto ela hesita na borda da luz forte, ela ataca; de longe a luz continua protegendo. Testes: `tools/test/creature-server-test.mjs`.
