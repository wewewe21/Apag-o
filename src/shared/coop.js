// Regras e numeros do cooperativo, compartilhados entre cliente e servidor.
// Tudo que voce pode querer ajustar (intervalos do fantasma, tempo de reconexao...) esta aqui.
import { CELL } from '../config.js';

export const COOP = {
  maxPlayers: 4,
  fusesTotal: 7,                    // fusiveis coletaveis no mapa (ids 1..7)
  soloFusesTotal: 5,                // usado para escalar a agressividade do diretor (mesma curva do solo)
  spawnSpacing: 0.9,                // m entre jogadores na largada (raio do jogador = 0,32)
  meeting: { forward: 1.9, radius: 2.6 },   // area de reuniao: m a frente do quadro e raio
  panelUseRadius: 2.4,              // m: distancia maxima do quadro para instalar fusivel
  pickupRadius: 3.0,                // m: distancia maxima de um item para pega-lo
  doorRadius: 3.2,                  // m: distancia maxima de uma porta/gaveta para usa-la
  hideRadius: 2.6,                  // m: distancia maxima de um esconderijo para entrar
  maxSpeed: 6.5,                    // m/s aceitos (corrida 4,9 + folga para atraso de rede)
  teleportSlack: 3.0,               // m: acima disso a posicao e corrigida pelo servidor
  reconnectGrace: 30,               // s que o personagem espera a volta do jogador antes de sair de vez
  ghost: { min: 45, max: 90, duration: 1.0, minDist: 5, maxDist: 9 },   // aparicao do espirito para os vivos (s)
  tick: 20,                         // Hz da simulacao no servidor
  snapshotEvery: 2,                 // envia estado a cada N ticks (=10 Hz)
  clientSendHz: 15,                 // frequencia com que o cliente envia o proprio estado
  interpDelay: 0.12,                // s de atraso na interpolacao dos jogadores remotos
  maxNameLen: 16,
  roomCodeLen: 4,
  finaleOnUnlock: true,             // ao completar os fusiveis: apagao + sirene + criatura enfurecida enquanto todos correm para a saida
};

// Criatura imitando a voz de um jogador (opcional, com autorizacao especifica de quem cede a voz).
// As frases sao GERADAS no navegador do dono da voz (modelo de voz local); o servidor so guarda os clipes curtos em memoria
// durante a sala/partida e decide QUANDO a criatura fala. Nada de gravacao bruta sai do computador do jogador.
export const MIMIC = {
  phrases: ['Achei um fusível.', 'Vem aqui.', 'Estou perto do quadro.', 'Me ajuda!', 'Aqui, rápido.'],
  needsFuseLeft: [0],                 // frases que so fazem sentido enquanto ainda ha fusiveis no mapa
  maxClips: 5, maxClipChars: 130_000, maxTotalChars: 560_000,   // limites de armazenamento (base64) por jogador
  sampleRates: [16000, 22050, 24000],
  interval: [40, 90],                 // s entre falas (sorteado); nunca em sequencia
  minGap: 30,
  states: ['patrol', 'investigate', 'search', 'lurk', 'stalk'],     // so quando ela NAO esta cacando/atacando/fugindo
  minPlayerDist: 3.5,                 // m: nao fala colada em alguem
};

// aproxima a agressividade: n fusiveis de 7 valem n*5/7 fusiveis do solo (mesma curva de dificuldade)
export const directorFuses = (installed) => installed * COOP.soloFusesTotal / COOP.fusesTotal;

// Onde ficam os fusiveis 6 e 7 (os 1..5 vem do layout do solo). Sao locais alcancaveis a pe (o teste do servidor confere).
// surface = mesa/carrinho/criado-mudo ja existente na celula [x,y]; floor = chao da celula com deslocamento.
export const EXTRA_FUSES = [
  { id: 6, surface: [17, 17], note: 'bancada do laboratorio' },
  { id: 7, surface: [37, 14], note: 'mesa da seguranca, ao lado da chave' },
];

// jogadores ganham nomes padrao se nao escolherem
export function cleanName(raw, fallback) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, COOP.maxNameLen);
  return s || fallback;
}

export function cleanCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, COOP.roomCodeLen);
}

export { CELL };
