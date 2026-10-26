# Movimentos do Guardião

As 13 ações foram recriadas com o Kimodo local em `C:/Users/WillianIA/Documents/kimodo-ai`. Foram comparadas 29 gerações reais. O jogo usa os novos movimentos de `assets/anim/creature.json`, adaptados ao corpo original de `assets/Character/Guardiao.fbx`.

A adaptação mantém a base dos pés mais larga, cotovelos fora do tronco, mãos em garra e transferência de peso pelos contatos dos pés. O ataque avança com as duas mãos, e a defesa da lanterna protege o rosto. A posição e a direção da IA continuam sob o controle do jogo. Geometria, texturas, pesos e vínculos do FBX permanecem originais.

Para comparar dentro do cenário, abra `/index.html?debug&guardianqa`. Escolha uma ação, use **Andar pelo cenário** para observar os apoios, **Perfil/Frente** para conferir a silhueta e **Comparar com anterior** para alternar a referência. O painel inicia uma partida Hardcore de inspeção, preservando o save Normal; recarregar a página retorna ao menu. Ele é uma ferramenta local de desenvolvimento e não entra no pacote publicado.

Os prompts, sementes, streams brutos e identificações dos modelos estão em `tools/kimodo_guardiao`. A auditoria da geração está em `tools/kimodo_guardiao/REVIEW.md`. O pacote anterior foi preservado em `.unlazy/guardian-motion/original-creature.json`.

Verificações:

```powershell
node tools/test/kimodo-guardian-test.mjs
node tools/test/guardian-heavy-rig-test.mjs
node tools/test/guardian-heavy-integration-test.mjs
node tools/test/guardian-regression-test.mjs
npm run build:client
```

O teste aleatório original da IA pode falhar também com as animações anteriores. A regressão reproduzível executa os mesmos testes existentes com seed42 na IA e compara separadamente a falha original de seed4242 com a versão nova. As asserções originais e a IA não foram modificadas. Essa instabilidade anterior está registrada em `.unlazy/guardian-motion/regression-reproducible.txt`.

Os movimentos são gerados em tempo de desenvolvimento; o jogo não executa Kimodo nem carrega seus modelos durante a partida.
