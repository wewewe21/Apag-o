// Configuracao do cliente que voce edita SEM mexer no codigo do jogo (e sem reconstruir nada):
// no GitHub Pages basta editar este arquivo e publicar de novo. Nao coloque segredos aqui: ele e publico.
//
//   serverUrl: endereco do servidor multiplayer (Render etc.), com https:// (o jogo usa wss:// sozinho).
//              Ex.: 'https://apagao-server.onrender.com'
//              Em desenvolvimento local (localhost) o padrao e http://localhost:8080.
//   iceServers: opcional. Se vazio, o jogo pede a lista ao servidor (GET /ice). Formato WebRTC:
//              [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:...', username: '...', credential: '...' }]
//              (evite credenciais fixas aqui: prefira TURN_SECRET no servidor, que gera credenciais temporarias)
//   mimicModelBase: opcional. De onde o navegador baixa o modelo de voz do "eco de voz" (so quando o jogador autoriza).
//              Vazio = Hugging Face (https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main/onnx). Para hospedar
//              os arquivos voce mesmo, aponte para uma pasta que tenha a subpasta portuguese/ (ver docs/PUBLICAR.md).
window.APAGAO_CONFIG = {
  serverUrl: '',
  iceServers: [],
  mimicModelBase: '',
};
