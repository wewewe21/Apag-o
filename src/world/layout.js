// Planta do Hospital-Colonia Santa Lucia.
// O mapa e um grid de celulas de 2 m. Terreo (nivel 0) e subsolo (nivel -1)
// nao se sobrepoem em planta: o subsolo fica a leste, ligado por uma escada.
//
// Caracteres do grid:
//   #  parede          .  piso            =  escada
//   D  porta           K  porta trancada (chave do subsolo)
//   J  porta emperrada (so abre pelo lado de dentro)
//   X  porta principal (saida)          M  parede de gavetas do necroterio
//
// Zonas (uma letra minuscula por celula de piso) guardam material, luz e som.

export const W = 60;
export const H = 40;

export const ZONES = {
  r: { name: 'Recepção',             level: 0,  floor: 'checker',  wall: 'ward',     ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 1, broken: 0.25, amb: 'hall' },
  h: { name: 'Corredor Norte',       level: 0,  floor: 'lino',     wall: 'ward',     ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 2, broken: 0.45, amb: 'corridor' },
  p: { name: 'Ala de Pacientes',     level: 0,  floor: 'lino',     wall: 'cell',     ceil: 'plaster',  lamp: 'bulb',  spacing: 3, sector: 3, broken: 0.5,  amb: 'cells' },
  l: { name: 'Laboratório',          level: 0,  floor: 'terrazzo', wall: 'clinic',   ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 3, broken: 0.3,  amb: 'lab' },
  f: { name: 'Farmácia',             level: 0,  floor: 'terrazzo', wall: 'clinic',   ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 3, broken: 0.4,  amb: 'lab' },
  e: { name: 'Enfermaria',           level: 0,  floor: 'lino',     wall: 'ward',     ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 4, broken: 0.45, amb: 'ward' },
  m: { name: 'Necrotério',           level: 0,  floor: 'morgue',   wall: 'morgue',   ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 4, broken: 0.35, amb: 'morgue', cold: true },
  t: { name: 'Sala de Autópsia',     level: 0,  floor: 'morgue',   wall: 'morgue',   ceil: 'tiles',    lamp: 'surg',  spacing: 4, sector: 4, broken: 0.2,  amb: 'morgue', cold: true },
  d: { name: 'Almoxarifado',         level: 0,  floor: 'concrete', wall: 'concrete', ceil: 'concrete', lamp: 'bulb',  spacing: 3, sector: 5, broken: 0.5,  amb: 'storage' },
  a: { name: 'Segurança',            level: 0,  floor: 'wood',     wall: 'office',   ceil: 'tiles',    lamp: 'fluor', spacing: 3, sector: 5, broken: 0.3,  amb: 'office' },
  q: { name: 'Arquivo',              level: 0,  floor: 'wood',     wall: 'office',   ceil: 'tiles',    lamp: 'bulb',  spacing: 3, sector: 5, broken: 0.55, amb: 'office' },
  z: { name: 'Escada de Serviço',    level: 0,  floor: 'concrete', wall: 'concrete', ceil: 'concrete', lamp: 'emerg', spacing: 3, sector: 0, broken: 0,    amb: 'basement', stairs: true },
  s: { name: 'Subsolo',              level: -1, floor: 'concrete', wall: 'concrete', ceil: 'concrete', lamp: 'bulb',  spacing: 4, sector: 6, broken: 0.6,  amb: 'basement' },
  i: { name: 'Incinerador',          level: -1, floor: 'brick',    wall: 'brick',    ceil: 'concrete', lamp: 'bulb',  spacing: 4, sector: 6, broken: 0.5,  amb: 'basement' },
  n: { name: 'Ala Noturna',          level: -1, floor: 'concrete', wall: 'cell',     ceil: 'concrete', lamp: 'none',  spacing: 0, sector: 0, broken: 1,    amb: 'noturna' },
  u: { name: 'Depósito de Corpos',   level: -1, floor: 'concrete', wall: 'morgue',   ceil: 'concrete', lamp: 'bulb',  spacing: 4, sector: 6, broken: 0.6,  amb: 'morgue', cold: true },
  c: { name: 'Casa de Caldeiras',    level: -1, floor: 'brick',    wall: 'brick',    ceil: 'concrete', lamp: 'bulb',  spacing: 3, sector: 6, broken: 0.4,  amb: 'boiler' },
  g: { name: 'Sala do Gerador',      level: -1, floor: 'concrete', wall: 'concrete', ceil: 'concrete', lamp: 'fluor', spacing: 3, sector: 6, broken: 0.5,  amb: 'generator' },
  w: { name: 'Cisterna Alagada',     level: -1, floor: 'concrete', wall: 'brick',    ceil: 'concrete', lamp: 'bulb',  spacing: 5, sector: 0, broken: 0.8,  amb: 'water', water: true },
  o: { name: 'Pátio',                level: 0,  floor: 'asphalt',  wall: 'facade',   ceil: 'sky',      lamp: 'street', spacing: 3, sector: 0, broken: 0,   amb: 'outside', outside: true },
};

// Em que ordem os setores voltam a ter luz a cada fusivel instalado.
export const SECTOR_ORDER = [1, 2, 3, 4, 5, 6];

export function buildLayout() {
  const grid = Array.from({ length: H }, () => Array(W).fill('#'));
  const zone = Array.from({ length: H }, () => Array(W).fill(null));
  const objects = [];
  const rooms = [];

  const room = (x0, y0, x1, y1, z) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { grid[y][x] = '.'; zone[y][x] = z; }
    rooms.push({ x0, y0, x1, y1, z });
  };
  const cell = (x, y, ch, z) => { grid[y][x] = ch; if (z) zone[y][x] = z; };
  const door = (x, y, z, ch = 'D') => cell(x, y, ch, z);
  const obj = (type, x, y, data = {}) => objects.push({ type, x, y, ...data });

  // ---------------- TERREO -----------------
  // faixa norte
  room(1, 1, 14, 8, 'e');              // Enfermaria
  room(16, 1, 25, 8, 'm');             // Necroterio
  room(27, 1, 34, 8, 't');             // Autopsia
  room(36, 1, 40, 8, 'd');             // Almoxarifado
  for (let x = 17; x <= 24; x++) grid[0][x] = 'M';   // banco de gavetas refrigeradas
  door(15, 6, 'm');                    // porta de servico enfermaria <-> necroterio
  door(26, 5, 't');                    // necroterio <-> autopsia

  // corredor norte
  room(1, 10, 40, 11, 'h');
  door(7, 9, 'e'); door(20, 9, 'm'); door(30, 9, 't'); door(38, 9, 'd');
  door(41, 10, 'z', 'K');              // porta do subsolo (chave)

  // ala de pacientes: corredor estreito com celas dos dois lados
  room(5, 13, 5, 25, 'p');
  room(1, 26, 10, 26, 'p');
  const cellRows = [[13, 15], [17, 19], [21, 24]];
  for (const [ya, yb] of cellRows) {
    room(1, ya, 3, yb, 'p');
    room(7, ya, 9, yb, 'p');
    door(4, ya + 1, 'p');
    door(6, ya + 1, 'p');
  }
  door(5, 12, 'p');

  // laboratorio + farmacia
  room(12, 13, 19, 19, 'l');
  room(12, 21, 19, 26, 'f');
  door(15, 12, 'l'); door(15, 20, 'f'); door(11, 26, 'f'); door(20, 16, 'l');

  // recepcao (hub) com passagem larga para o corredor
  room(21, 13, 30, 26, 'r');
  cell(25, 12, '.', 'r'); cell(26, 12, '.', 'r');
  cell(25, 27, 'X', 'r'); cell(26, 27, 'X', 'r');

  // seguranca + arquivo
  room(32, 13, 40, 18, 'a');
  room(32, 20, 40, 26, 'q');
  door(37, 12, 'a'); door(31, 15, 'a'); door(36, 19, 'q'); door(31, 23, 'q');

  // patio externo (so acessivel no final)
  room(23, 28, 28, 31, 'o');

  // ---------------- ESCADA + SUBSOLO -----------------
  room(42, 10, 46, 10, 'z');
  for (let x = 42; x <= 46; x++) grid[10][x] = '=';
  room(47, 10, 52, 10, 's');
  room(52, 2, 52, 37, 's');
  room(47, 2, 50, 8, 'i');   door(51, 5, 'i');
  room(47, 12, 50, 21, 'n'); door(51, 16, 'n');
  room(47, 23, 50, 37, 'u'); door(51, 30, 'u');
  room(54, 2, 58, 10, 'c');  door(53, 6, 'c');
  room(54, 12, 58, 22, 'g'); door(53, 17, 'g', 'J');   // emperrada pelo lado do corredor
  room(54, 24, 58, 37, 'w'); door(53, 28, 'w');
  door(56, 23, 'g');                                       // cisterna -> gerador

  // ---------------- OBJETOS -----------------
  obj('playerStart', 25.5, 23.5, { yaw: Math.PI });   // olhando para o norte
  obj('checkpoint', 25.5, 23.5, { yaw: Math.PI });
  obj('creatureSpawn', 21, 3);
  obj('panel', 23, 26, { wall: 's' });
  obj('exitDoor', 25, 27);
  obj('exitTrigger', 25.5, 30.5);
  obj('mapPoster', 21, 20, { wall: 'w' });

  // fusiveis
  obj('fuse', 8, 23, { id: 1, on: 'nightstand' });
  obj('fuse', 13, 2, { id: 2, on: 'cart' });
  obj('fuse', 40, 21, { id: 3, on: 'desk' });
  obj('fuse', 0, 0,  { id: 4, drawer: 13 });            // dentro da gaveta 13
  obj('fuse', 57, 13, { id: 5, on: 'bench' });

  obj('key', 38, 14, { on: 'desk' });

  // baterias
  for (const [x, y] of [[18, 14], [33, 2], [39, 7], [13, 25], [55, 3], [48, 20], [22, 13]]) obj('battery', x, y);

  // documentos (lore + dicas diegeticas)
  obj('note', 24, 17, { id: 'aviso' });
  obj('note', 2, 14, { id: 'diario' });
  obj('note', 12, 6, { id: 'enfermagem' });
  obj('note', 28, 7, { id: 'autopsia' });
  obj('note', 34, 14, { id: 'vigia' });
  obj('note', 13, 17, { id: 'pesquisa' });
  obj('note', 49, 14, { id: 'noturna' });

  // esconderijos: H = armario, B = embaixo da cama/maca
  const H_ = (x, y) => obj('locker', x, y);
  const B_ = (x, y, kind = 'bed') => obj('bed', x, y, { kind });
  H_(14, 8); H_(1, 4);                                 // enfermaria
  H_(19, 19);                                          // laboratorio
  H_(19, 26);                                          // farmacia
  H_(40, 13); H_(32, 18);                              // seguranca
  H_(32, 26);                                          // arquivo
  H_(34, 8);                                           // autopsia
  H_(36, 1); H_(40, 8);                                // almoxarifado
  H_(1, 11); H_(33, 11);                               // corredor norte
  H_(58, 10); H_(58, 22);                              // caldeiras, gerador
  H_(47, 8);                                           // incinerador
  // camas das celas
  for (const [ya] of cellRows) { B_(1, ya); B_(9, ya); }
  // enfermaria (leitos com cortinas)
  for (const x of [2, 5, 8, 11]) { B_(x, 1, 'ward'); }
  for (const x of [2, 5, 8]) { B_(x, 8, 'ward'); }
  // macas do necroterio e deposito de corpos
  B_(18, 6, 'gurney'); B_(23, 6, 'gurney');
  B_(47, 13, 'bed'); B_(47, 17, 'bed');
  B_(49, 26, 'gurney'); B_(49, 33, 'gurney'); B_(47, 29, 'gurney');

  // moveis que bloqueiam a celula
  obj('autopsyTable', 29, 4); obj('autopsyTable', 32, 4);
  obj('desk', 22, 17, { len: 3, kind: 'reception' });
  obj('desk', 37, 14, { len: 2, kind: 'office' });
  obj('desk', 40, 21, { len: 1, kind: 'office' });
  obj('desk', 13, 14, { len: 3, kind: 'lab' });
  obj('desk', 16, 17, { len: 3, kind: 'lab' });
  obj('desk', 56, 13, { len: 2, kind: 'bench' });
  obj('nurseStation', 12, 4);
  obj('cart', 13, 2);
  obj('nightstand', 8, 23);
  for (let y = 21; y <= 24; y++) obj('shelf', 34, y);
  for (let y = 22; y <= 25; y++) obj('shelf', 37, y);
  for (let y = 21; y <= 23; y++) obj('shelf', 39, y);
  for (let y = 2; y <= 6; y++) obj('shelf', 38, y);
  for (let x = 14; x <= 17; x++) obj('shelf', x, 23);  // prateleiras da farmacia
  obj('boiler', 55, 5); obj('boiler', 57, 8);
  obj('generator', 56, 17);
  obj('incinerator', 49, 2);
  obj('breakerBoard', 58, 15, { wall: 'e' });

  // dutos de ventilacao usados pela criatura para se deslocar
  for (const [x, y] of [[40, 5], [1, 26], [12, 13], [40, 26], [1, 1], [34, 1], [47, 12], [58, 2], [47, 37], [1, 10], [30, 26]]) obj('vent', x, y);

  // luzes de emergencia (bateria propria: sempre acesas, vermelhas e fracas)
  for (const [x, y] of [[21, 14], [30, 14], [28, 26], [4, 10], [14, 11], [24, 10], [34, 10], [40, 11],
                         [5, 13], [44, 10], [50, 10], [52, 4], [52, 20], [52, 34], [36, 13], [19, 21]]) obj('emerg', x, y);

  return { W, H, grid, zone, objects, rooms, zones: ZONES };
}

export function dumpAscii(L) {
  const out = [];
  for (let y = 0; y < L.H; y++) {
    let s = '';
    for (let x = 0; x < L.W; x++) {
      const g = L.grid[y][x];
      s += g === '.' ? (L.zone[y][x] || '?') : g;
    }
    out.push(s);
  }
  return out.join('\n');
}
