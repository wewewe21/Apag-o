# Assets 3D (Tripo)

## Estado (2026-10-20)

**Os 8 modelos foram gerados e estao no jogo** (`assets/models/`, 6,1 MB no total, texturas 1024, 17 a 19 mil triangulos cada).
A API do Tripo recusava tudo (saldo de API = 0, erro `2010`), entao a geracao foi feita pelo **Tripo Studio (web)**, com os 395 creditos da conta
do usuario (o login foi dele; nenhuma senha ou chave foi digitada nem guardada). Gastos: **300 creditos em 12 geracoes** (8 assets + 4 refeitos
porque a 1a versao nao servia); **sobraram 95**.

| Asset | Substitui | No mundo hoje | Obs. |
|---|---|---|---|
| `hospital_bed` | cama (enfermaria e ala) | 15 | `yaw -90` (cabeceira em -Z, pe em +Z); esconder embaixo da cama testado |
| `wheelchair` | cadeira de rodas | 11 | `yaw 90` (apoios de pe para +Z) |
| `gurney` | maca | 14 | 2a geracao (a 1a veio com encosto levantado, curta e alta); `fit exact` + `overlayY -0.24` para o corpo apoiar no colchao |
| `covered_body` | corpo coberto (`cadaver`) | 6 | 2a geracao (a 1a veio com uma maca embutida); `fit exact` para esticar o comprimento |
| `autopsy_table` | mesa de autopsia | 2 | 2a geracao (a 1a veio com o tampo inclinado e curto); `yaw 90`, `fit exact` (altura 0,88) |
| `restraint_chair` | cadeira de contencao | 2 | sem ajuste |
| `iv_stand` | suporte de soro | **0** | gerado, mas o layout atual nao sorteia esse prop (o mundo e deterministico); entra sozinho se o layout mudar |
| `medical_cart` | carrinho | 1 | 2a geracao (a 1a ficou baixa: os itens do jogo, que ficam a 0,855 m, flutuariam); `grow 1.45` |

Nada do que nao foi pedido mudou: colisao, navegacao, esconderijos e `server/worldspec.json` continuam **identicos byte a byte** (conferido).
`dist/` **nao foi reconstruido** (`npm run build` antes de publicar).

Ficaram sem gerar (`later` em `assets.json`): a boneca e o cavalinho do quarto de crianca (ver abaixo).

O que existe (tudo testado):

| Peca | Onde | O que faz |
|---|---|---|
| Lista do que gerar | `tools/tripo/assets.json` | 8 assets com o prompt final usado, tamanho alvo, giro e o que cada um substitui (+ `_nota` do que foi refeito e por que) |
| Executor da API | `tools/tripo/run.mjs` | (so com credito de API) cria as tarefas, espera, baixa o `.glb` para quarentena, controla o gasto |
| Processador | `tools/tripo/process.py` | valida o GLB (dado nao confiavel), reduz textura, publica em `assets/models/` |
| Carregador no jogo | `src/world/models.js` + `vendor/gltf/` | normaliza escala/origem/frente, ajusta cor e material ao estilo do jogo |
| Gancho no mundo | `World.skin()` em `src/world/world.js` | troca so o VISUAL do prop; colisao, navegacao e esconderijos nao mudam |
| QA visual | `tools/test/models-qa.js` | no painel do navegador: `inspect(id)` (vista 3/4 + de cima com os eixos do jogo) e `viewModel(id, n)` (leva o jogador ate a instancia) |
| Testes | `tools/test/models-test.mjs` (esta no `npm test`) | 55 checagens, inclusive o executor contra um Tripo falso local e a estrutura dos modelos publicados |

Sem `assets/models/manifest.json` (ou vazio), o jogo e identico ao de antes: nada aqui e obrigatorio.

## Gerar mais pelo Tripo Studio (sem credito de API)

Estas foram as configuracoes que funcionaram (o Studio salva sozinho):

1. `https://studio.tripo3d.ai/pt/workspace/generate`, o **usuario faz o login**; modo **texto** = icone do lapis (4o).
2. Prompt = `prompt` do asset em `assets.json` + a frase `style` (o Studio nao tem campo de negativo: `no floor, no shadow` ja vai dentro do texto).
3. Configuracao economica: modelo **H3.0 Equilibrado**, textura **2K**, **PBR desligado**, poligonos **20000** (digitar no campo) = **25 creditos** por modelo
   (o padrao H3.1 custa 55). Cada modelo tem "Tentar novamente gratis (x1)".
4. O plano gratis aceita **3 tarefas ao mesmo tempo**; a 4a abre um aviso de upgrade (nao assinar: so fechar).
5. **Exportar** (GLB, textura 2k) e gratis. O Studio monta o arquivo no proprio navegador e o app o salva em `Downloads\<uuid>.tmp`;
   confira que comeca com `glTF` e **mova** para `tools/tripo/raw/<id>/model.glb`. (Uma pagina https nao consegue enviar para um servidor local: o `fetch` falha.)
6. `python -I tools/tripo/process.py` e confira no jogo com `tools/test/models-qa.js`.

Licoes de prompt: o Tripo ignora medidas, mas respeita a **forma**. "Maca" saiu como cadeira reclinada ate eu escrever "perfectly horizontal flat ... no raised backrest";
"corpo coberto" veio sobre uma maca ate eu escrever "lying directly on the ground, no stretcher, no table, no bed, no base"; a mesa saiu inclinada ate o prompt dizer
"very long and narrow, perfectly flat and horizontal, no tilt".

## Rodar pela API (so se a conta de API tiver credito)

```powershell
$env:TRIPO_API_KEY = "tsk_..."          # a chave NUNCA vai para arquivo do projeto
npm run assets3d:plan                    # saldo + o que seria gerado (nao gasta nada)
npm run assets3d:generate                # gera tudo que falta, em ordem de prioridade, ate acabar o credito
npm run assets3d:process                 # valida, reduz textura e publica em assets/models/
```

Depois abra o jogo: os modelos entram sozinhos. Confira **a frente** de cada um (cama: cabeceira na parede; cadeira de rodas: apoio de pe
para frente). Se algum estiver virado, ajuste `yaw` (graus) naquele asset em `tools/tripo/assets.json` e rode `assets3d:process` de novo
(nao gasta credito; usa o `.glb` ja baixado em `tools/tripo/raw/`).

### Custo (economico)
- Custo real medido no Studio: **25 creditos** por modelo na configuracao economica (acima); 8 assets = 200 creditos, mais o que for refeito. Pela API o custo depende da versao do modelo; a primeira geracao mede o real.
- `generate` confere o saldo antes de cada asset, **mede o custo real** (saldo antes - depois) e so continua se o saldo cobrir o proximo.
- Nunca regera um asset ja baixado (so com `--force id`). `--only a,b`, `--max-assets N` e `--max-credits N` limitam o gasto.
- Os `.glb` baixados ficam em `tools/tripo/raw/<id>/model.glb` (quarentena) e o estado em `tools/tripo/state.json`; so o que passa no `process.py` vai para o jogo.

## O que foi escolhido gerar (e por que)

Prioridade pelo que mais aparece e mais pesa: `hospital_bed` (15 camas), `wheelchair` (corredores e subsolo), `gurney` (macas), `covered_body`
(o corpo sob o lencol), `autopsy_table`, `restraint_chair` (Ala Noturna), `iv_stand`, `medical_cart`. Todos os prompts reusam o mesmo
texto de estilo (`style` + `negative` em `assets.json`): hospital publico brasileiro abandonado dos anos 90, ferrugem e sujeira, paleta cinza-esverdeada
dessaturada, objeto unico sem fundo. Alem do prompt, o carregador **dessatura, escurece e esfria** a textura e fixa rugosidade/metal
por tipo (`material` no manifesto) para tudo parecer do mesmo universo do jogo.

Ficaram para depois (lista `later` em `assets.json`): a boneca e o cavalinho do quarto de crianca. Aquele sistema (`child-ward.js`) junta
tudo por material e os testes de assombracao dependem de nomes e limites das pecas; integrar com cuidado.
Itens que NAO valem troca: armarios (`locker`: a porta tem frestas reais e animacao), portas, gavetas do necroterio, lampadas, dutos
(todos funcionais), e a criatura (ja e um modelo).

## Como a integracao funciona

- Convencao do jogo: origem no centro da base, frente em +Z, metros. O Tripo entrega escala, origem e frente arbitrarias:
  `prepareModel` mede a caixa do modelo, gira por `spec.yaw`, escala para caber em `spec.size` (`fit`: `contain` padrao | `height` | `exact`) e poe a base no chao.
- O modelo nunca passa da **pegada de colisao** do prop (`res.w x res.d`): encolhe se precisar, nunca amplia. Por isso colisao e navegacao nao mudam.
  Unica excecao, opt-in: `grow` (>1) no asset deixa passar ate `grow` x a pegada (so o carrinho usa: a bandeja precisa ficar a 0,855 m, onde o jogo poe os itens).
- Campos do asset que viram `spec` no manifesto: `size`, `fit` (`contain` | `height` | `exact`), `yaw` (graus, giro em Y para a frente ficar em +Z), `replaces`, `material`,
  `keepOverlay` (mantem o corpo na maca / a bandeja), `overlayY` (m; desloca essas partes mantidas para o colchao/tampo do modelo) e `grow`.
  O Tripo entrega o eixo longo em X: confira cada modelo com `inspect(id)` (a bolinha azul e +Z, a frente do jogo) e ajuste `yaw` antes de qualquer outra coisa.
- `res.top` (altura da superficie onde o jogo pousa fusiveis, chaves e bilhetes) e as `surfaces` **nao** mudam com o modelo: o servidor tambem as usa (`worldspec`). Um modelo cuja
  superficie util fique em outra altura faz os itens flutuarem ou afundarem; foi por isso que o 1o carrinho foi refeito.
- `skin(kind, res)` troca os filhos do grupo procedural pelo modelo (varias instancias compartilham geometria e material). Partes marcadas
  `userData.overlay` (corpo sobre a maca, bandeja de instrumentos) ficam se o modelo declarar `keepOverlay`.
- Tipos que `World.skin` conhece: `bed:ward`, `bed:bed`, `gurney`, `wheelchair`, `autopsyTable`, `cart`, e os decorativos sorteados
  (`iv`, `restraint`, `bench`, `cabinet`, ...). `cadaver` e consultado dentro de `props.js`. Para um tipo novo: `replaces: ["tipo"]` no asset; se o tipo ja passa por `make(k)`/`P.*` ja funciona.
- Regra de ouro: **nao pode haver consumo de sorteios (`rng`) diferente com e sem modelo**: o gerador do mundo e compartilhado e qualquer diferenca
  desloca toda a mobilia sorteada e a colisao do servidor (o teste `models-test` compara a especificacao inteira do servidor com e sem modelos; ja pegou esse erro uma vez).
- Servidor e `scripts/gen-worldspec.mjs` nao carregam modelos (`World` sem biblioteca): `server/worldspec.json` e o mesmo byte a byte.
- Build: `scripts/build-client.mjs` copia `vendor/gltf/` e `assets/` (inclui `assets/models/`). **`dist/` nao foi reconstruido** (`npm run build` antes de publicar).

## Testar sem gastar credito

- `node tools/test/models-test.mjs`: normalizacao, biblioteca (`grow`), mundo com modelos (colisao identica, `overlayY`), a estrutura dos modelos publicados
  (cabecalho GLB, bytes, texturas <= 1024, peso), `process.py` (rejeita GLB truncado, com decodificador que o jogo nao tem, ou com imagem externa) e o executor da API
  contra um servidor falso (custo medido, parada por saldo, nao paga duas vezes, chave nunca impressa, erro com a chave dentro sai mascarado).
- Visual, no painel do navegador com o jogo em `http://localhost:8765/?debug`: `const q = await import('/tools/test/models-qa.js?v=' + Date.now()); await q.install();`
  e depois `inspect('gurney')` / `viewModel('covered_body', 0)` (so olha; nao muda nada).
- Modelos SINTETICOS (imitam a saida do Tripo: escala/origem/frente trocadas, textura grande demais) em `tools/test/fixtures/`
  (`python -I tools/test/fixtures/make_synthetic_models.py` regenera). Para ver no jogo: `http://localhost:8765/?debug&models=/tools/test/fixtures/models/manifest.json`
  (o parametro `models` so vale com `?debug`). Nunca entram em `assets/`.

## Seguranca

- A chave so vem de `TRIPO_API_KEY` (ambiente). `run.mjs` nao a grava, nao a imprime e mascara qualquer mensagem que a contenha; o build recusa
  segredos em `dist/` (e `tools/` nunca e copiado).
- No caminho do Studio o login e sempre do usuario (nenhuma senha e digitada pelo agente) e nada de conta, cookie ou chave vai para arquivo do projeto.
- O `.glb` baixado (da API ou do Studio) e dado nao confiavel: `process.py` roda isolado (`python -I`), le so bytes/JSON, valida cabecalho, tamanhos, extensoes, URIs e limites
  antes de qualquer outro uso, e o jogo so carrega o que ele publicou.
