# Produção sonora do APAGÃO

Pacote gerado e integrado: 6 trilhas e 128 arquivos de efeitos/ambientes, com 861,5 segundos no total e 16,0 MiB para reprodução. Todos os 134 arquivos possuem proveniência ElevenLabs, integridade verificada, decodificação válida e margem contra clipping.

Para ouvir as trilhas e efeitos separadamente, abra `http://localhost:8765/tools/audio/` com o servidor do jogo ativo. O arquivo sonoro permite buscar sons e alternar as variações.

O catálogo em `tools/audio/catalog.mjs` especifica seis trilhas originais: exploração, subsolo, presença, perseguição, carga do gerador e fuga. Os ambientes têm identidades para hospital, necrotério, ala noturna, subsolo, caldeiras, cisterna e chuva. Os efeitos cobrem as interações, respiração, coração, lanterna, dutos e dez vocalizações da criatura, com variações de passos e presenças espirituais adicionais.

## Gerar

1. Crie `.env.local` na raiz com `ELEVENLABS_API_KEY=sk_...`, usando a chave secreta exibida pelo ElevenLabs ao criar ou rotacionar a chave. O gerador também aceita `.env`. Um identificador de chave não funciona.
2. Instale Node 20+, FFmpeg e FFprobe se ainda não estiverem disponíveis. A Music API exige um plano pago.
3. `npm run audio:plan` mostra eventos, duração e número de arquivos sem autenticar ou gastar créditos.
4. `node tools/audio/generate.mjs --check-key` valida a chave e consulta o plano, sem gerar áudio.
5. `npm run audio:generate` produz o catálogo completo, normaliza os volumes e empacota os arquivos Ogg para o navegador.
6. `npm run audio:verify` verifica todos os arquivos, duração, decodificação, silêncio, integridade e margem contra clipping. `npm run audio:test` verifica o código, com fixtures temporárias que nunca entram no jogo.

`node tools/audio/generate.mjs --only=score_explore,whisper` gera apenas os IDs indicados. Execuções normais reutilizam arquivos verificados e masters existentes. `--force` solicita nova geração paga. Não repetir automaticamente uma geração após erro de transporte: o serviço pode já ter produzido e cobrado o resultado.

São usados `music_v2_5` e `eleven_text_to_sound_v2`. A música é solicitada em MP3 48 kHz/192 kbps; efeitos, em 44,1 kHz/192 kbps nos planos compatíveis e 128 kbps no Free/Starter. Os masters originais e a proveniência ficam em `assets/audio/source/`, excluídos do Git e do servidor local. O jogo recebe apenas Ogg normalizado a 48 kHz e um manifesto sem credenciais. Ogg não aumenta a qualidade do master; é o formato de reprodução do pacote.

## Mixagem e verificação no jogo

O evento de captura pelo monstro foi restaurado ao áudio original do jogo: vocalização sintetizada de ataque, impacto dissonante e zumbido de morte. Esse evento ignora os masters `creature_attack`, `death` e o stinger gerado; os demais eventos continuam com o pacote ElevenLabs.

As presenças da ala infantil acrescentam 13 arquivos: risadas discretas, a melodia mecânica do brinquedo, três batidas de porta, duas quedas de copo e seis passos fantasmas mono. Os sons usam HRTF e a melodia acompanha a posição do brinquedo. O controlador evita sobrepor sustos às pistas do inimigo. O comportamento, a persistência e a paranoia no escuro estão descritos em [HAUNTING.md](HAUNTING.md).

O master `children_laughter` foi regenerado isoladamente para tornar as vocalizações humanas mais reconhecíveis, com risadas articuladas e pequenos murmúrios. O alvo passou de -31 para -27 LUFS; o ganho normal foi de 0,32 para 0,38 e o filtro atrás das portas preserva mais definição vocal. Todos os outros masters ficaram intactos. O hash novo no manifesto invalida o cache desse áudio.

As trilhas entram por estado local, proximidade da criatura e tensão. A troca para perseguição é imediata; as outras mudanças aguardam estabilização por 2,5 segundos. O esconderijo reduz a música. Os loops se sobrepõem nas fronteiras e as mudanças usam fades. A fuga toca uma vez. Pistas importantes reduzem temporariamente a trilha e o coração.

Os passos foram refeitos com 54 tomadas ElevenLabs: seis por material (linóleo, cerâmica, pedra/granilite, concreto, tijolo, asfalto, madeira e água), mais seis para o Noturno. Cerâmica serve à recepção e ao necrotério; granilite aos laboratórios; madeira ao arquivo e à segurança; água à cisterna; tijolo ao incinerador e às caldeiras, com piso visível correspondente. Escadas sempre usam concreto. A consulta de água vale também para jogadores cooperativos e para a criatura.

Foley de jogador é mono a -28 LUFS, com filtragem dos graves excessivos e ganho local de 0,45; fica aproximadamente 10,5 dB abaixo da configuração anterior. Agachar e correr mantêm diferenças de intensidade. A afinação varia apenas ±1,5%. Cada conjunto usa todas as seis tomadas antes de repetir, sem repetição na passagem entre conjuntos. O antigo baque sintetizado dos passos foi retirado; durante a carga dos arquivos o jogador não recebe esse substituto. Isso não muda o ruído percebido pela IA.

O passo do Noturno é mono a -21 LUFS, com ganho 0,95 ao andar / 1,1 ao correr e alcance maior que o dos jogadores. Uma camada discreta do material sob seus pés acrescenta água, madeira ou contato com o piso. Seus passos próximos reduzem brevemente a música e o coração.

Todos os passos, incluindo os próprios pés alternados, usam HRTF. A orientação e a altura da câmera alimentam o ouvinte 3D. O filtro de oclusão e a atenuação por paredes/portas atualizam até 12,5 vezes por segundo com transição suave; a distância também reduz frequências altas. Até 24 vozes pontuais são mantidas. A decodificação prioriza passos, acontece em segundo plano e trilhas inativas são liberadas. Os demais efeitos conservam a síntese original quando faltam arquivos. Nenhuma chamada à API paga acontece durante uma partida.

No catálogo, cada passo tem uma prévia de seis tomadas em 3D, com seleção de frente, direita, atrás e esquerda. O volume da prévia segue o ajuste do jogo; o botão de reprodução comum permite ouvir o arquivo isolado.

A página `/index.html?debug&audioqa` executa cenários de reprodução no jogo real, decodifica o catálogo completo pelo navegador e mede a saída WebAudio. Também renderiza o roteamento HRTF em OfflineAudioContext e mede esquerda/direita, rotação da cabeça, diferença frente/trás, distância e parede. O manifesto e `window.__game.audio.library.stats` registram quais sons foram carregados e reproduzidos. `node tools/test/footsteps-test.mjs` verifica oito materiais no mapa real, água cooperativa, ganhos, variações e oclusão dinâmica. `/index.html?debug&hauntqa` verifica o encontro único, a ala e as novas presenças.

A revisão técnica verifica transições, pausa, pistas posicionais e sinal de áudio. A escuta artística final com fones deve avaliar exploração em cada área, corrida e mudança de piso, criatura atrás de uma parede, perseguição, esconderijo/prender a respiração, fusíveis, carga/alarme, morte/recomeço e fuga. Esta sessão não oferece entrada de áudio ao assistente: não foi possível atestar a experiência por audição. Testes de sinal e código não substituem essa escuta.

Referências técnicas: [Music API](https://elevenlabs.io/docs/api-reference/music/compose), [Sound Effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [autenticação](https://elevenlabs.io/docs/api-reference/authentication).
