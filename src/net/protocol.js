// Vocabulario comum de cliente e servidor do cooperativo (mensagens sao JSON: { t: 'tipo', ... }).
// v2: fusiveis sorteados por partida (sync.items[].dr) e salas com espectadores. Cliente e servidor de versoes diferentes se recusam com um aviso claro.
export const PROTOCOL_VERSION = 2;

export const PHASE = { LOBBY: 'lobby', PLAYING: 'playing' };

// codigos de erro que o servidor devolve em { t:'err', code, msg }
export const ERR = {
  BAD_MSG: 'bad_msg', RATE: 'rate_limited', NO_ROOM: 'no_room', ROOM_FULL: 'room_full', ROOM_STARTED: 'room_started',
  NOT_HOST: 'not_host', NOT_READY: 'not_ready', SERVER_FULL: 'server_full', VERSION: 'version', ORIGIN: 'origin',
  NAME: 'name', ALREADY: 'already', DENIED: 'denied',
};

// estado de movimento informado pelo cliente
export const MOVE = { IDLE: 0, WALK: 1, CROUCH: 2, SPRINT: 3 };

// bits de "flags" no estado de cada jogador
export const FLAG = { HIDDEN: 1, BREATH: 2, FLASH: 4, SPRINT: 8, MOVING: 16, SPECTATOR: 32, OFFLINE: 64, ESCAPED: 128 };

// indices compactos usados nos snapshots da criatura
export const CREATURE_STATES = ['dormant', 'patrol', 'investigate', 'stalk', 'chase', 'search', 'inspect', 'stunned', 'flee', 'lurk', 'vent', 'hesitate', 'attack'];
export const CREATURE_SUBS = [null, 'walk', 'run', 'look', 'approach', 'listen', 'goto', 'enter', 'travel', 'exit'];
export const CLIPS = ['idle', 'walk', 'limp', 'stalk', 'run', 'look', 'inspect', 'crawl', 'roar', 'recoil', 'attack', 'pain', 'shield', 'creep'];      // so acrescentar no fim (o indice vai na rede)

// resultado da partida
export const RESULT = { WIN: 'win', LOSE: 'lose', ABORT: 'abort' };

// motivos de recusa de instalar fusivel etc.
export const REASON = {
  NOT_NEAR: 'not_near', TAKEN: 'taken', NOT_YOURS: 'not_yours', GATHER: 'gather', DEAD: 'dead', LOCKED: 'locked', JAMMED: 'jammed',
  NO_KEY: 'no_key', OCCUPIED: 'occupied', HIDDEN: 'hidden', BUSY: 'busy', PHASE: 'phase',
};
