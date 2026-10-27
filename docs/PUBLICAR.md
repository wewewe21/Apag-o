# Publicar o APAGÃO (cliente no GitHub Pages + servidor no Render gratuito)

Nada aqui foi feito por mim nas suas contas: você executa os passos. Não há segredos no cliente nem no repositório.

## 1. Colocar o projeto no GitHub
1. Crie um repositório vazio (ex.: `apagao`) em github.com.
2. Na pasta do projeto: `git init`, `git add .`, `git commit -m "APAGAO"`, `git branch -M main`, `git remote add origin https://github.com/SEU-USUARIO/apagao.git`, `git push -u origin main`.
3. Confira antes que `.env` NÃO foi enviado (o `.gitignore` já o exclui; ele guarda a chave do ElevenLabs).

## 2. Servidor multiplayer no Render (plano Free)
1. render.com > New > Web Service > conecte o repositório.
2. Runtime **Node**; Root Directory: vazio; Build Command: `npm ci --omit=dev`; Start Command: `npm start` (= `node server/index.js`).
3. Instance Type: Free. Advanced > Health Check Path: `/health`.
4. Environment: `NODE_ENV=production`, `NODE_VERSION=20`, `ALLOWED_ORIGINS=https://SEU-USUARIO.github.io` (só a origem, sem caminho e sem barra final; várias separadas por vírgula).
5. Depois do deploy, anote a URL: `https://NOME.onrender.com`. Teste no navegador: `https://NOME.onrender.com/health` deve mostrar `{"ok":true,...}`.
- O plano gratuito hiberna após ~15 min sem uso; o primeiro acesso leva cerca de 1 minuto (o jogo mostra "Acordando o servidor…").
- Salas ficam só na memória: se o servidor reiniciar, as partidas terminam e os jogadores são avisados.

## 3. Cliente no GitHub Pages
1. No repositório: Settings > Pages > Source: **GitHub Actions** (o workflow `.github/workflows/pages.yml` já existe).
2. Diga onde está o servidor, de UMA das formas: (a) edite `runtime-config.js` (`serverUrl: 'https://NOME.onrender.com'`) e faça push; ou (b) Settings > Secrets and variables > Actions > Variables > `APAGAO_SERVER_URL`.
3. Faça push na `main` (ou Actions > Publicar no GitHub Pages > Run workflow). O site fica em `https://SEU-USUARIO.github.io/apagao/`.
- **Precisa reconstruir o cliente?** Só se mudar o endereço do servidor: é um novo push (o Actions reconstrói). O servidor não precisa mudar, exceto `ALLOWED_ORIGINS` se o endereço do site mudar.
- Build local para conferir: `npm ci`, `npm run build:client -- --server-url=https://NOME.onrender.com`, `node tools/serve-dist.mjs --base=/apagao/` e abra `http://localhost:9090/apagao/`.

## 4. Voz (chat e eco de voz)
- Chat de voz: WebRTC direto entre jogadores; usa STUN público. Em redes restritivas (4G/CGNAT/empresas) pode falhar sem servidor **TURN**. Opções: coturn próprio (`TURN_URLS` + `TURN_SECRET` no Render) ou um serviço TURN de terceiros (`ICE_SERVERS_JSON`). Isso pode ter custo; o jogo funciona sem, com essa limitação.
- **Ninguém se ouve?** Na partida, abra o menu (Esc) > painel **Voz**: ele lista cada jogador como `conectado`, `conectando…` ou `sem conexão`. Se aparecer `sem conexão`, é a rede (precisa de TURN). Passo a passo com serviço gratuito de terceiros: crie uma conta num provedor TURN (ex.: Open Relay da Metered, ou Cloudflare Realtime TURN), copie as credenciais e, no painel do Render > Environment, crie `ICE_SERVERS_JSON` com `[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:HOST:80","turn:HOST:443?transport=tcp"],"username":"USUARIO","credential":"SENHA"}]` (troque HOST/USUARIO/SENHA pelos dados do provedor) e faça Manual Deploy. O jogo busca essa lista em `GET /ice`; não precisa mexer no cliente.
- Modo do microfone: no painel Voz, **Microfone aberto** ou **Apertar para falar** (tecla configurável, padrão V). O ícone de alto-falante aparece ao lado do nome de quem está falando, no canto inferior esquerdo.
- Eco de voz (criatura imitando a voz de quem autoriza): opcional; o navegador baixa ~146 MB do Hugging Face só se o jogador autorizar. Para hospedar você mesmo, use `mimicModelBase` em `runtime-config.js`. Créditos/licenças: `vendor/NOTICE.md`.

## 5. Verificar depois de publicar
1. Abra o site: aparece o título; Normal/Hardcore funcionam sozinhos.
2. Online: "Conectado" (na primeira vez, aguarde o servidor acordar). Crie sala em uma aba e entre com o código em outra/outro aparelho; a 5ª pessoa entra como espectador (fila) e a 11ª é recusada.
3. Inicie a partida, permita o microfone e confirme que os outros ouvem (perto natural, longe rádio). Teste em redes diferentes.
4. Se não conectar: F12 > Console/Rede. 403 = `ALLOWED_ORIGINS` diferente da origem real do site.

## 6. Migrar para outro provedor depois
Servidor: qualquer host com Node ≥ 20 (Fly, Railway, VPS): `npm ci --omit=dev && npm start`, variáveis `PORT` (automática), `NODE_ENV`, `ALLOWED_ORIGINS`. Cliente: qualquer hospedagem estática com o conteúdo de `dist/`. Só `serverUrl` e `ALLOWED_ORIGINS` mudam.

## Testes
`npm test` roda os testes automáticos (servidor, eco de voz no servidor, hospedagem, build). Os testes que precisam de navegador estão em `tools/test/*.js`.
Não testado por mim: microfone real, conexões entre redes diferentes, voz de uma pessoa real no eco de voz.
