// Onde os fusiveis podem aparecer e como sortear: a CADA PARTIDA o conjunto muda (nunca dois no mesmo lugar).
// Codigo puro (sem three.js): usado pelo servidor (sala online), pelo cliente (solo) e pelos testes.
//
// Um "ponto" (spot) e uma superficie onde o fusivel pousa: mesa, bancada, carrinho, mesinha, cama, maca... ou o interior de uma gaveta
// do necroterio (escolhida entre todas). As regras de sorteio ficam em pickFuseLayout().

export const FUSE_KIND_TEXT = {
  cart: 'o carrinho', nightstand: 'a mesinha de cabeceira', table: 'a mesa de apoio', desk: 'a mesa', bench: 'a bancada',
  bed: 'a cama', gurney: 'a maca', drawer: 'uma gaveta',
};

// zonas onde NUNCA aparece fusivel: recepcao (todo mundo comeca ali), corredores e escada, Ala Noturna (covil), cisterna alagada, patio
const OFF_ZONES = new Set(['r', 'h', 's', 'z', 'n', 'w', 'o']);
// gavetas que nao recebem fusivel: 13 (a lenda do necroterio) e 23 (a que ja nasce aberta e vazia)
const DRAWER_BLOCKED = new Set([13, 23]);

const r3 = (v) => Math.round(v * 1000) / 1000;

// Le um World (do jogo ou do servidor, antes de virar spec) e devolve todos os pontos possiveis.
export function collectFuseSpots(world) {
  const L = world.L, spots = [];
  const info = (cx, cy) => {
    const zc = L.zone[cy] && L.zone[cy][cx], z = zc && L.zones[zc];
    return z ? { zone: zc, room: z.name, basement: z.level < 0, outside: !!z.outside } : null;
  };
  const keyCells = L.objects.filter(o => o.type === 'key').map(o => [o.x, o.y]);
  const nearKey = (cx, cy) => keyCells.some(([kx, ky]) => Math.abs(kx - cx) <= 1 && Math.abs(ky - cy) <= 1);
  for (const [k, s] of world.surfaces) {
    const [cx, cy] = k.split(',').map(Number), zi = info(cx, cy);
    if (!zi || zi.outside || OFF_ZONES.has(zi.zone) || nearKey(cx, cy)) continue;       // a mesa da chave fica so com a chave
    spots.push({ id: 's' + k, kind: s.kind || 'desk', cell: [cx, cy], ...zi, x: r3(s.x), y: r3(s.y + 0.002), z: r3(s.z) });
  }
  for (const h of world.hideSpots) {
    if (h.type !== 'bed' || !h.res || !h.res.top) continue;
    const [cx, cy] = h.cell, zi = info(cx, cy);
    if (!zi || zi.outside || OFF_ZONES.has(zi.zone)) continue;
    spots.push({ id: 'b' + cx + ',' + cy, kind: h.res.top > 0.8 ? 'gurney' : 'bed', cell: [cx, cy], ...zi, x: r3(h.x), y: r3(h.base + h.res.top + 0.002), z: r3(h.z) });
  }
  spots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));          // ordem estavel: o mesmo sorteio da o mesmo resultado
  return spots;
}

// ---------------------------------------------------------------------------
// Sorteio. rng: () => [0,1). drawers: [{num, x, y, z}] (z ja e a frente da gaveta). ids: numeros dos fusiveis a distribuir.
// Regras:
//  - cada fusivel num ponto diferente, e dois fusiveis nunca ficam a menos de minDist metros um do outro (afrouxa aos poucos se nao couber);
//  - no maximo 1 por sala (2 na Ala de Pacientes, que tem varios quartos);
//  - entre basementMin e basementMax no subsolo (a chave continua importante, e o subsolo nao fica lotado);
//  - a gaveta e UM dos candidatos (nao uma certeza) e vale como sala 'm' (necroterio).
// Devolve [{ id, spot, drawer? }] na ordem dos ids.
export function pickFuseLayout(spots, drawers, ids, rng, opts = {}) {
  const count = ids.length;
  const minDist = opts.minDist ?? 8, basementMin = opts.basementMin ?? 1, basementMax = opts.basementMax ?? 2;
  const drawerPool = drawers.filter(d => !DRAWER_BLOCKED.has(d.num));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const DRAWER = { id: 'drawer', kind: 'drawer', zone: 'm', room: 'Necrotério', basement: false, virtual: true };

  const attempt = (D, strict) => {
    const chosen = [], zones = {}; let basement = 0;
    const order = shuffle(drawerPool.length ? [...spots, DRAWER] : spots);
    for (const c0 of order) {
      if (chosen.length >= count) break;
      let c = c0;
      if (c0.virtual) {                                    // escolhe a gaveta na hora: tenta algumas ate uma servir
        let pick = null;
        for (const d of shuffle(drawerPool).slice(0, 8)) if (chosen.every(q => Math.hypot(q.x - d.x, q.z - d.z) >= D)) { pick = d; break; }
        if (!pick) continue;
        c = { ...DRAWER, x: pick.x, y: pick.y, z: pick.z, drawer: pick.num };
      }
      const cap = c.zone === 'p' ? 2 : 1;
      if ((zones[c.zone] || 0) >= cap) continue;
      if (c.basement && basement >= basementMax) continue;
      if (!chosen.every(q => Math.hypot(q.x - c.x, q.z - c.z) >= D)) continue;
      chosen.push(c); zones[c.zone] = (zones[c.zone] || 0) + 1; if (c.basement) basement++;
    }
    if (chosen.length < count) return null;
    if (strict && basement < basementMin) return null;
    return chosen;
  };
  let chosen = null;
  for (let i = 0; i < 300 && !chosen; i++) chosen = attempt(Math.max(3, minDist - Math.floor(i / 60) * 1.5), true);
  for (let i = 0; i < 100 && !chosen; i++) chosen = attempt(2, false);          // ultimo recurso: so nao repete ponto
  if (!chosen) throw new Error('nao ha pontos suficientes para ' + count + ' fusiveis');
  const order = shuffle(ids);                                // qual fusivel (1..7) vai em qual ponto tambem muda
  return chosen.map((c, i) => ({ id: order[i], spot: c, drawer: c.drawer ?? null }));
}

// definicao de item para o servidor: { key, type, id, x, y, z, drawer? }
export function fuseItemDef(a) {
  const s = a.spot;
  return { key: 'fuse:' + a.id, type: 'fuse', id: a.id, x: s.x, y: s.y, z: s.z, ...(a.drawer != null ? { drawer: a.drawer } : {}) };
}

// pistas para o Livro de Ocorrencias: descreve alguns dos pontos sorteados, sem entregar todos
export function fuseHints(layout, rng, n = 3) {
  const text = (a) => {
    const s = a.spot;
    if (a.drawer != null) return `na gaveta ${a.drawer} do necrotério`;
    return `sobre ${FUSE_KIND_TEXT[s.kind] || 'um móvel'} (${s.room})`;
  };
  const pool = layout.slice(); const out = [];
  while (out.length < n && pool.length) out.push(text(pool.splice(Math.floor(rng() * pool.length), 1)[0]));
  return out;
}
