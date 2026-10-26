// Todos os numeros de balanceamento em um lugar so.
// Unidades: metros, segundos, 0..1 para medidores.

// As paredes do grid sao "finas": uma celula de parede vira uma laje de 20 cm
// no centro da celula, e as metades livres viram piso das salas vizinhas.
export const CELL = 1.25;           // tamanho de uma celula do grid (m)
export const WALL_T = 0.2;          // espessura das paredes
export const WALL_H = 3.2;          // pe-direito
export const DOOR_H = 2.2;
export const BASEMENT_Y = -4.0;     // altura do piso do subsolo

export const PLAYER = {
  radius: 0.32,
  eyeStand: 1.62,
  eyeCrouch: 0.95,
  walk: 2.6,
  crouch: 1.25,
  sprint: 4.9,
  accel: 14,
  stamina: 1,                 // 1 = cheio
  staminaDrain: 0.16,         // por segundo correndo (~6 s de corrida)
  staminaRegen: 0.11,
  staminaRegenDelay: 1.2,
  exhaustedUntil: 0.35,       // precisa recuperar ate aqui depois de zerar
  mouseSens: 0.0022,
};

// Ruido: raio (m) em que a criatura escuta o evento.
export const NOISE = {
  walk: 4.5,
  crouch: 1.0,
  sprint: 13,
  water: 11,                  // passos na agua (cisterna)
  door: 7,
  doorSlam: 15,               // abrir porta correndo
  locker: 5,
  gasp: 10,
  pickup: 3.5,
  install: 9,
  drawer: 7,
  flashlightClick: 2.5,
};

export const FLASHLIGHT = {
  battery: 1,
  drainOn: 1 / 420,           // ~7 min de feixe normal
  drainFocus: 1 / 45,         // foco consome ~9x mais
  batteryPickup: 0.45,
  lowBattery: 0.15,
  // feixe normal
  angle: 0.42,                // radianos (meio-cone ~24 graus)
  distance: 22,
  intensity: 55,
  // foco (botao direito): unico modo que fere a criatura
  focusAngle: 0.2,
  focusDistance: 30,
  focusIntensity: 150,
  focusChargeTime: 0.22,      // tempo para o foco "acender" totalmente
  heatPerSec: 0.21,           // ~4.8 s de foco continuo ate superaquecer
  coolPerSec: 0.16,
  overheatLock: 3.5,          // lanterna apagada apos superaquecer
  // dano na criatura
  burnRange: 9.5,             // alcance efetivo do foco no rosto
  burnConeDeg: 11,            // precisao exigida (graus do centro)
  burnTime: 0.6,              // exposicao continua no rosto para repelir
  burnHabituation: 0.35,      // +35% de tempo exigido por repelida recente
  habituationDecay: 50,       // s para esquecer uma repelida
  eyeshineRange: 32,          // olhos brilham ao serem iluminados
};

export const CREATURE = {
  height: 3,
  // colisao: corpo (circulo) e cabeca (circulo a frente do corpo, so contra paredes/moveis altos). O alcance da cabeca varia com o clipe
  // (medido no modelo real: MAIOR distancia da cabeca ao pivo em cada clipe, em m). Cliente e servidor usam a MESMA tabela.
  bodyRadius: 0.38,
  headRadius: 0.22,
  headReach: { idle: 0.87, walk: 0.77, creep: 0.7, limp: 0.77, stalk: 0.95, run: 0.79, look: 0.79, inspect: 0.99, crawl: 0.98, roar: 0.94, recoil: 0.7, attack: 0.89, pain: 0.8 },
  turnRate: { calm: 3.6, alert: 5.5, chase: 7.5 },   // rad/s maximos de giro (antes girava "escorregando" enquanto andava)
  speed: {
    patrol: 1.25,
    investigate: 1.9,
    stalk: 1.05,
    chase: 4.25,              // um pouco abaixo do sprint do jogador
    search: 1.6,
    flee: 5.2,
    enraged: 4.7,
  },
  darkSpeedBonus: 1.18,       // multiplica no escuro
  litSpeedPenalty: 0.72,      // multiplica em area iluminada (luz de teto)
  litThreshold: 0.45,         // nivel de luz da celula considerado "iluminado"
  fov: 118 * Math.PI / 180,
  viewRange: 24,
  // percepcao v2 (visao central + periferica, sensor de proximidade, movimento):
  fovealHalf: 0.5,            // rad: cone central (~57 graus no total): sensibilidade cheia
  peripheralHalf: 1.4,        // rad: ate ~80 graus para cada lado: sensibilidade cai de 0,6 para 0,25
  senseRange: 2.4,            // m: "sente" quem esta muito perto (bafo, calor, passos) sem precisar olhar, se nao ha parede no meio
  senseRate: 1.5,             // medidor/s do sensor de proximidade (jogador andando; parado x0,35; agachado x0,6)
  instantRange: 1.3,          // m: colado nela e a vista = percebido na hora
  stillFactor: 0.6,           // parado (quase sem mexer) e mais dificil de notar
  visBase: 0.5,               // visibilidade base no escuro total (ela e noturna); a luz soma ate +0,7
  memoryDecay: 0.35,          // o medidor cai mais devagar por ~1,2 s depois de perder o jogador de vista (nao "esquece" numa piscada)
  detectRate: 0.95,           // por segundo, vendo o jogador em condicoes base
  detectDecay: 0.28,
  suspicionAt: 0.35,          // entra em espreita
  chaseAt: 1.0,
  catchRadius: 1.15,
  loseSightTime: 3.2,         // continua "sabendo" onde o jogador esta por X s apos perder visao
  searchTime: [22, 34],
  investigateLook: [4, 8],
  stunTime: 1.6,              // cambaleando apos queimadura
  fleeTime: [6, 10],          // se escondendo no escuro depois de repelida
  enrageOnBodyHit: 3,         // s de raiva se o foco acertar o corpo e nao o rosto
  hearingMult: 1.0,
  lockerCheckChance: 0.35,    // chance de checar um esconderijo proximo durante a busca
  inspectTime: 4.2,           // tempo parado na frente do esconderijo
  // olhar fixo: a cabeca fica erguida e TRAVADA no jogador (sem baixar nem balancar com o passo) SO quando ela esta ciente (espreita, caca, hesita, ataca,
  // ou esta vendo o jogador): assim a cabeca ainda avisa que ele foi visto. on: true estende o olhar para patrulha, busca e fuga tambem
  // (nao encara farejando esconderijo, cambaleando ou no duto), ate `range` metros.
  stare: { on: false, range: 45 },
};

export const DIRECTOR = {
  menaceUp: 0.075,            // por segundo com a criatura perto/cacando
  menaceDown: 0.035,
  breatherAt: 1.0,            // tensao maxima -> criatura se afasta (respiro)
  breatherTime: [28, 45],
  hintEvery: [40, 70],        // de tempos em tempos a criatura recebe uma "pista" da regiao do jogador
  hintRadius: [7, 13],
  aggressionPerFuse: 0.18,
};

// Batimento cardiaco individual: quanto mais perto a criatura, mais rapido e forte. Nao afeta a IA.
export const HEARTBEAT = {
  farDist: 18,             // m: alem disso nao ha batimento (por causa da exaustao ainda pode haver)
  nearDist: 2.2,           // m: batimento no maximo
  curve: 1.5,              // >1: sobe mais devagar de longe e mais rapido de perto
  bpm: [58, 148],          // frequencia (batidas/min) longe -> perto
  volume: [0.06, 0.5],     // ganho do barramento do coracao (0..1) longe -> perto
  bpmExertion: 22,         // bpm extra com a estamina esgotada
  volumeExertion: 0.16,    // ganho extra maximo por exaustao
  attack: 1.4,             // 1/s: rapidez com que sobe quando ela se aproxima (transicao gradual)
  release: 0.45,           // 1/s: rapidez com que desce quando ela se afasta (mais lento que a subida)
  offRelease: 5,           // 1/s: sumico rapido ao morrer, encerrar ou voltar ao menu
  floorGap: 2.5,           // m de diferenca de altura a partir da qual conta como outro andar (sem batimento)
  duck: 0.45,              // ganho relativo do coracao durante passos/gritos/pistas da criatura (nao encobre nada)
};

export const DOOR_CHARGE_TIME = 32;   // s para a porta principal destravar no final
export const HOLD_BREATH = 6.5;       // s maximo prendendo a respiracao
export const FUSES_TOTAL = 5;

export const QUALITY = {
  low:    { scale: 0.6,  lights: 4, shadow: 512,  texture: 256 },
  medium: { scale: 0.8,  lights: 6, shadow: 1024, texture: 512 },
  high:   { scale: 1.0,  lights: 8, shadow: 2048, texture: 1024 },
};
