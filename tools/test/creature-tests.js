// Medicoes do comportamento da criatura no navegador (console, pagina com ?debug):
//   const t = await import('/tools/test/creature-tests.js?v=1');
//   await t.locomotion({ seconds: 120 });   // animacao x movimento: deslize de pes, clipe errado, giro, atravessar parede/movel
//   await t.detection();                     // tempo ate a criatura notar o jogador (distancia, luz, agachado, lanterna, parado/andando)
// Cada funcao devolve { ok, ...numeros } e imprime um resumo.
import { boot, THREE } from '/tools/test/browser-helpers.js?v=1';

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const LOCO = new Set(['walk', 'limp', 'stalk', 'run', 'crawl', 'creep']);
const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// cabeca/corpo dentro de parede ou movel alto? (2D; caixas com vision=true sao altas)
function penetration(g, x, z, r, ignoreDoors = true) {
  const [qx, qz] = g.grid.collideCircle(x, z, r, { ignore: (b) => ignoreDoors && !!b.door || !b.vision });
  return Math.hypot(qx - x, qz - z);
}

async function setup({ freeze = false, blind = true } = {}) {
  const g = await boot({ start: 'normal' });
  g.freezeAI = false;
  g.wakeCreature();
  const ai = g.ai;
  ai.stateT = 1; ai.firstWalk = false; ai.pauseT = 0;
  if (blind) { ai._perceive = ai.perceive; ai.perceive = function () { this.sees = false; this.meter = Math.max(0, this.meter - 0.05); }; }
  return g;
}

export async function locomotion({ seconds = 120, states = ['patrol', 'investigate', 'search', 'stalk', 'chase', 'flee'] } = {}) {
  const g = await setup({ blind: true });
  const ai = g.ai, m = ai.m, grid = g.grid;
  const out = { states: {}, total: { frames: 0, moving: 0 } };
  const S = (name) => out.states[name] || (out.states[name] = { frames: 0, moving: 0, wrongClip: 0, slide: [], headErr: 0, turnLag: 0, bodyPen: 0, headPen: 0, maxHeadPen: 0, maxBodyPen: 0, switches: 0, clips: {} });
  let prev = null, lastClip = null, tScene = 0, scene = 0;
  const player = g.player;
  const cellsFloor = [];
  for (let y = 0; y < grid.H; y++) for (let x = 0; x < grid.W; x++) if (grid.isFloor(x, y) && grid.navWalkable(x, y) && grid.zoneCfg(x, y) && !grid.zoneCfg(x, y).outside && grid.levelBase(x, y) === 0) cellsFloor.push([x, y]);
  const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const pick = () => cellsFloor[Math.floor(rnd() * cellsFloor.length)];
  const teleportPlayer = (x, z) => { player.pos.set(x, grid.floorY(x, z), z); };
  g.player.pos.y = 0;
  const dbg = window.dbg;
  const each = (t) => {
    // a cada ~14 s troca de cenario: novo estado e destino aleatorio
    if (t >= tScene) {
      tScene = t + 14; const st = states[scene++ % states.length];
      const [cx, cy] = pick(); const gx = grid.cx(cx), gz = grid.cz(cy);
      const [px, py] = pick();
      teleportPlayer(grid.cx(px), grid.cz(py));
      ai.knowT = 20; ai.meter = (st === 'chase' || st === 'stalk') ? 0.9 : 0; ai.exposure = 0; ai.habit = 0; ai.tgt = null;
      if (ai.level < 0 || ai.vent) { const sp = g.world.creatureSpawn; ai.vent = null; ai.pos.set(sp.x, grid.floorY(sp.x, sp.z), sp.z); }
      if (st === 'patrol') { ai.setState('patrol'); ai.goal = new THREE.Vector3(gx, 0, gz); ai.pauseT = 0; ai._arrived = false; }
      else if (st === 'investigate') { ai.setState('investigate', 'walk'); ai.goal = new THREE.Vector3(gx, 0, gz); }
      else if (st === 'search') { ai.setState('search'); ai.searchAround(new THREE.Vector3(gx, 0, gz)); }
      else if (st === 'stalk') { ai.tgt = ai.nearestView(); ai.setState('stalk'); ai.lastSeen.set(gx, 0, gz); ai.meter = 0.6; }
      else if (st === 'chase') { ai.tgt = ai.nearestView(); ai.setState('chase'); ai.lastSeen.copy(player.pos); ai.stateT = 0.5; }
      else if (st === 'flee') { ai.setState('flee'); ai.fleeGoal = new THREE.Vector3(gx, 0, gz); }
      prev = null;
    }
    if (ai.state === 'chase') { ai.knowT = 5; }
    if (ai.state === 'stalk') { ai.meter = Math.max(ai.meter, 0.5); }
    if (!['chase', 'stalk'].includes(ai.state) && ai.meter > 0.3) ai.meter = 0.3;      // sem gatilho de deteccao: so mede o movimento
    // amostra o quadro anterior (pos e clipe ja atualizados)
    if (prev) {
      const dx = ai.pos.x - prev.x, dz = ai.pos.z - prev.z, dt = 1 / 30;
      const sp = Math.hypot(dx, dz) / dt;
      const st = S(prev.state); st.frames++; out.total.frames++;
      const clip = m.current;
      st.clips[clip] = (st.clips[clip] || 0) + 1;
      if (lastClip && lastClip !== clip) st.switches++; lastClip = clip;
      if (prev.state === 'vent') { prev = { x: ai.pos.x, z: ai.pos.z, state: ai.state }; return; }
      if (sp > 0.4) {
        st.moving++; out.total.moving++;
        if (!LOCO.has(clip)) st.wrongClip++;
        else {
          const a = m.actions[clip]; const ts = a ? a.getEffectiveTimeScale() : 1;
          const natural = m.clipSpeed(clip) * ts;                       // m/s que os pes "andam" no chao
          if (natural > 0.05) st.slide.push(sp / natural);
        }
        const heading = Math.atan2(dx, dz), err = Math.abs(angleDiff(ai.yaw, heading));
        if (err > 0.6) st.headErr++;
      }
      // colisao: corpo (r=0,32) e cabeca (r=0,14) contra paredes/moveis altos
      const bp = penetration(g, ai.pos.x, ai.pos.z, 0.32);
      const hd = m.headWorld(new THREE.Vector3());
      const hp = penetration(g, hd.x, hd.z, 0.14);
      if (bp > 0.05) st.bodyPen++; if (hp > 0.05) st.headPen++;
      st.maxBodyPen = Math.max(st.maxBodyPen, bp); st.maxHeadPen = Math.max(st.maxHeadPen, hp);
    }
    prev = { x: ai.pos.x, z: ai.pos.z, state: ai.state };
  };
  dbg.sim(seconds, each);
  const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const rows = {};
  let bad = 0;
  for (const [k, s] of Object.entries(out.states)) {
    rows[k] = { frames: s.frames, moving: s.moving, wrongClipPct: +(100 * s.wrongClip / Math.max(1, s.moving)).toFixed(1), slideMedian: q(s.slide, 0.5), slideP10: q(s.slide, 0.1), slideP90: q(s.slide, 0.9), headingErrPct: +(100 * s.headErr / Math.max(1, s.moving)).toFixed(1), bodyPenPct: +(100 * s.bodyPen / Math.max(1, s.frames)).toFixed(1), headPenPct: +(100 * s.headPen / Math.max(1, s.frames)).toFixed(1), maxBodyPen: +s.maxBodyPen.toFixed(2), maxHeadPen: +s.maxHeadPen.toFixed(2), clipSwitchesPerMin: +(s.switches / Math.max(1, s.frames / 1800)).toFixed(1), clips: s.clips };
  }
  console.table(rows);
  return { rows, total: out.total };
}

// tempo ate a criatura passar a perseguir o jogador (ou "nunca" ate o limite) em varias condicoes.
// Usa um jogador FALSO (visao de jogador) e chama ai.update direto: controla luz, postura e lanterna sem depender da entrada.
export async function detection({ maxSeconds = 12, facing = 'front', dists = [3, 6, 10, 16], only = null, offAxis = 0 } = {}) {
  const g = await boot({ start: 'normal' });
  const ai = g.ai, grid = g.grid;
  g.freezeAI = false; g.wakeCreature(); g.state = 'playing';
  let best = null;
  for (let y = 0; y < grid.H; y++) { let run = 0, x0 = 0; for (let x = 0; x <= grid.W; x++) { const ok = x < grid.W && grid.isFloor(x, y) && !grid.navBlock[grid.idx(x, y)] && grid.levelBase(x, y) === 0 && grid.zoneCfg(x, y) && !grid.zoneCfg(x, y).outside; if (ok) { if (!run) x0 = x; run++; } else { if (run >= 20 && (!best || run > best.n)) best = { y, x0, n: run }; run = 0; } } }
  if (!best) return { ok: false, err: 'sem corredor longo' };
  const z = grid.cz(best.y), xs = grid.cx(best.x0 + 1);
  const conds = [
    { name: 'claro, parado', light: 0.9, crouch: 0, sprint: false, fl: false, still: true },
    { name: 'claro, andando', light: 0.9, crouch: 0, sprint: false, fl: false },
    { name: 'escuro, parado', light: 0.0, crouch: 0, sprint: false, fl: false, still: true },
    { name: 'escuro, andando', light: 0.0, crouch: 0, sprint: false, fl: false },
    { name: 'escuro, agachado', light: 0.0, crouch: 1, sprint: false, fl: false },
    { name: 'escuro, lanterna ligada', light: 0.0, crouch: 0, sprint: false, fl: true },
    { name: 'escuro, correndo', light: 0.0, crouch: 0, sprint: true, fl: false },
  ].filter(c => !only || only.includes(c.name));
  const rows = [];
  const realLight = g.lighting.lightAt, realTargets = g.targets;
  for (const c of conds) for (const d of dists) {
    const view = { id: 1, pos: new THREE.Vector3(xs + d, 0, z), eye: new THREE.Vector3(xs + d, 1.6, z), hidden: null, holdingBreath: false, crouch: c.crouch, sprinting: c.sprint, dead: false,
      fl: { on: c.fl, focus: 0, beam() { return { on: c.fl, pos: view.eye.clone(), dir: new THREE.Vector3(-1, 0, 0), angle: 0.4, focus: 0 }; }, illum() { return c.fl ? 1 : 0; } } };
    view.pos.y = grid.floorY(view.pos.x, view.pos.z);
    g.targets = () => [view]; g.lighting.lightAt = () => c.light;
    ai.hardReset(); ai.activate({ x: xs, z }); ai.firstWalk = false; ai.goal = null; ai.setState('patrol'); ai.stateT = 5;
    ai.m.group.visible = true;
    ai.pos.set(xs, grid.floorY(xs, z), z); ai.yaw = (facing === 'front' ? Math.PI / 2 : facing === 'side' ? 0 : -Math.PI / 2) + offAxis; ai.meter = 0; ai.pauseT = 999; ai.tgt = null;
    const li = grid.idx(grid.cellX(xs), grid.cellY(z)), oldL = grid.light[li]; grid.light[li] = c.light;
    const yaw0 = ai.yaw; g.onCaught = () => {}; g.playerDies = () => {};
    let tS = null, tC = null, t = 0;
    for (let i = 0; i < maxSeconds * 30 && tC == null; i++) {
      if (!c.still) { const w = Math.sin(t * 5.6) * 0.25; view.pos.z = z + w; view.eye.z = z + w; }          // anda de um lado para o outro a ~1,4 m/s
      ai.update(1 / 30); t += 1 / 30;
      ai.pos.set(xs, grid.floorY(xs, z), z); ai.yaw = yaw0;                    // so mede a percepcao: a criatura nao se move nem gira
      g.state = 'playing';
      ai.m.group.position.copy(ai.pos); ai.m.group.rotation.y = ai.yaw; ai.m.update(1 / 30, ai.pos.y, t);      // atualiza os ossos (a cabeca e usada na linha de visao)
      if (tS == null && ai.meter >= 0.35) tS = +t.toFixed(2);
      if (ai.state === 'chase' || ai.state === 'attack' || ai.state === 'hesitate') tC = +t.toFixed(2);     // hesitate = percebeu, mas esta em luz forte e nao avanca
    }
    grid.light[li] = oldL;
    rows.push({ cond: c.name, dist: d, meterEnd: +ai.meter.toFixed(2), suspicion: tS, chase: tC });
  }
  g.lighting.lightAt = realLight; g.targets = realTargets;
  console.table(rows);
  return { rows };
}

// esconderijos: a criatura vai ate cada armario/esconderijo, fareja e, com o jogador dentro, puxa e ataca. Mede cabeca/corpo dentro do movel.
export async function hideSpots({ limit = 40 } = {}) {
  const g = await boot({ start: 'normal' });
  const ai = g.ai, m = ai.m, grid = g.grid, spots = g.world.hideSpots.slice(0, limit);
  g.freezeAI = false; g.wakeCreature(); ai.perceive = function () { this.sees = false; };
  g.onCaught = () => {}; g.playerDies = () => {}; const realUnhide = g.forceUnhide; g.forceUnhide = () => {};
  const realTargets = g.targets;
  const rows = [];
  for (const spot of spots) {
    const worst = { body: 0, head: 0 };
    const sample = () => {
      const b = penetration(g, ai.pos.x, ai.pos.z, 0.32);
      const hd = m.headWorld(new THREE.Vector3()); const h = penetration(g, hd.x, hd.z, 0.14);
      worst.body = Math.max(worst.body, b); worst.head = Math.max(worst.head, h);
    };
    ai.hardReset(); ai.activate({ x: spot.inspectPos.x + 4, z: spot.inspectPos.z }); ai.stateT = 5; ai.firstWalk = false;
    const p0 = g.world.creatureSpawn; ai.pos.set(spot.inspectPos.x, grid.floorY(spot.inspectPos.x, spot.inspectPos.z), spot.inspectPos.z);
    // a) fareja na frente do esconderijo (vazio)
    g.targets = () => [];
    ai.beginInspect(spot, 'patrol'); ai.sub = 'listen'; ai.stateT = 0; ai.listenTime = 3;
    window.dbg.sim(3.5, sample);
    // b) com o jogador escondido: puxa e ataca
    const view = { id: 1, pos: new THREE.Vector3(spot.x, grid.floorY(spot.x, spot.z), spot.z), eye: new THREE.Vector3(spot.x, 1.5, spot.z), hidden: spot, holdingBreath: false, crouch: 0, sprinting: false, dead: false, fl: null };
    g.targets = () => [view];
    ai.setState('inspect', 'listen'); ai.inspectSpot = spot; ai.stateT = 0; ai.listenTime = 3;
    ai.pullOut(spot); view.hidden = null; view.pos.set(spot.inspectPos.x + (spot.inspectPos.x - spot.x) * 0.3, view.pos.y, spot.inspectPos.z + (spot.inspectPos.z - spot.z) * 0.3);
    window.dbg.sim(2.2, sample);
    rows.push({ spot: (spot.type || '?') + '@' + Math.round(spot.x / 1.25) + ',' + Math.round(spot.z / 1.25), body: +worst.body.toFixed(2), head: +worst.head.toFixed(2) });
  }
  g.targets = realTargets; g.forceUnhide = realUnhide;
  const bad = rows.filter(r => r.head > 0.05 || r.body > 0.05);
  console.table(bad.length ? bad : rows.slice(0, 5));
  return { n: rows.length, bad, maxHead: Math.max(...rows.map(r => r.head)), maxBody: Math.max(...rows.map(r => r.body)) };
}
