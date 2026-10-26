# A cena de morte

Antes: o Noturno encostava, o clipe `attack` quase nao mexe (as duas maos ficam coladas na cabeca) e a tela escurecia. Agora a captura e uma cena fixa, a mesma toda vez, de ~3 s, em primeira pessoa. O **som nao foi alterado**: o grito/estouro sai em 0 s (`beginAttack`) e o 2o estouro em 0,75 s (`CreatureAI.uAttack` -> `Game.playerDies` -> `audio.death`), exatamente como antes; a cena foi desenhada em cima desses dois marcos.

## Roteiro (segundos desde a captura)

| t | o que acontece |
|---|---|
| 0,00 | grito de ataque. A criatura aparece de frente (se veio por tras, o jogador gira de uma vez), ergue-se com os bracos abertos (clipe `roar`) e o jogador recua |
| 0,20 | o bote: o tronco dobra ~80 graus sobre o jogador, como um abutre, e o rosto desce ate a altura dos olhos (~0,5 m). A cabeca se inclina de lado, sem tirar os olhos da camera |
| 0,75 | **agarrao**: as maos fecham dos DOIS LADOS da cabeca do jogador (dedos longos e abertos, como aranha) junto com o 2o estouro. Pancada (FOV abre, borrao radial, clarao), congelada de ~0,1 s so na criatura, sangue na lente |
| 0,85 | ela se endireita erguendo o jogador (a camera sobe ate a altura do rosto dela), sacode, mais sangue |
| 2,00 | bote final: o pescoco se projeta e a camera e puxada para dentro da boca; a lanterna morre |
| 2,42 | clarao vermelho e preto (o sangue fica por cima da tela preta) |
| 3,05 | tela "ELE TE PEGOU" |

## Onde esta cada coisa

- `src/entities/deathscene.js`: o roteiro (`sampleDeath(t)`, funcao pura e testavel), a camera (recuo, puxao, subida, tremor, rolagem, FOV), a luz de apoio que garante o rosto visivel mesmo sem lanterna, o sangue na lente (canvas 2D) e o controle da criatura durante a cena. Constantes de tempo em `DEATH`.
- `src/entities/deathpose.js`: a pose do corpo, aplicada por cima de qualquer clipe (nenhum clipe do jogo tem bote ou agarrao). Dobra tronco/pescoco e inclina a cabeca no esqueleto SOMA; leva as maos aos lados da cabeca do jogador por IK nos ossos do FBX (`_solveLimb` do movimento do Skinwalker) e abre os dedos (`splay`). Primeira versao: bracos esticados para frente com garra caida = pose de zumbi, trocada de proposito.
- `src/entities/creature.js`: dois ganchos em `CreatureModel.update` (`applySoma` antes do retarget, `applyFbx` no fim). So agem quando a cena liga `deathPose.on`.
- `src/fx/postfx.js`: uniformes novos `shock`, `flash`, `tunnel` (0 = desligado, o jogo normal nao muda).
- `src/main.js`: `onCaught` comeca a cena; `_update` a roda (depois da IA, antes do modelo) e aplica os efeitos por ultimo; a tela de morte espera a cena acabar; `respawn`/`restartRun` e `online._becomeGhost` chamam `deathScene.reset()`.
- `CreatureAI` e `NetCreature` (coop) deixam a criatura em paz enquanto `game.deathScene.driving`. O servidor nao sabe da cena (ela e so do cliente de quem morre; os outros jogadores veem o ataque normal).

## Ajustar

Tudo que e numero esta em `sampleDeath` (tempos e intensidades) e `DEATH` (`faceDist` = distancia do rosto aos olhos, `impactT`, `biteT`...). A dobra maxima e a compensacao da cabeca ficam em `POSE` (`deathpose.js`). Se mudar o tempo do 2o estouro de som em `CreatureAI.uAttack` (0,75 s), mude `DEATH.impactT` junto.

## Testar

- `node tools/test/death-scene-test.mjs` (tambem em `npm test`): roteiro (marcos, faixas, continuidade, deterministico) e a classe com jogo falso (ciclo completo, reset, segunda morte).
- No navegador (`?debug`): `dbg.kill()` dispara a cena de verdade (`dbg.kill(1.4)` muda a distancia). Para ver quadros parados: `const qa = await import('/tools/test/death-qa.js'); await qa.setup(); qa.play(0.77); qa.advance(0.5)` e tirar uma captura; `qa.pose({fold:1, neck:.3, reach:1})` + `qa.fp()` / `qa.side()` mostram so a pose.

## Camera calma no fim

No bote final a camera e puxada para dentro da boca. A mira parte do ponto SEM essa puxada (`DeathScene.eye`) e o tremor de rotacao quase some (`calm`), senao a direcao camera->cabeca fica instavel e a camera gira a mais de 2000 graus/s (medido). Agora o pico e ~200 graus/s e a rolagem maxima ~9 graus. O tremor do agarrao (0,75 a 2 s) continua como era.
