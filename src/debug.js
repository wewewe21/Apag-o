// Ferramentas de depuracao/teste (carregadas com ?debug na URL). Uso no console: dbg.tp(25, 20)
import * as THREE from 'three';
import { CELL } from './config.js';

export function installDebug(game) {
  const fake = () => {
    const keys = new Set(), hits = new Set();
    return {
      keys, hits,
      mouse: { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false },
      down: (c) => keys.has(c), hit: (c) => hits.has(c), up: () => false,
      endFrame() { hits.clear(); this.mouse.dx = this.mouse.dy = 0; },
    };
  };
  const sync = () => { game.player._applyCamera(0, 0); game.camera.updateMatrixWorld(true); };
  const dbg = window.dbg = {
    game, sync,
    tp(x, z, yaw = 0, pitch = 0) { game.player.spawn(x * CELL, z * CELL, yaw); game.player.pitch = pitch; sync(); },
    lights(on = true) { game.lighting.setPowered(on ? [1, 2, 3, 4, 5, 6] : [], false); },
    freeze(on = true) { game.freezeAI = on; },
    noAura() { const orig = game.lighting.update.bind(game.lighting); game.lighting.update = (dt, t, c) => orig(dt, t, c, null); },
    creature(x, z, yaw = 0, clip = 'idle') {
      const ai = game.ai;
      if (ai.state === 'dormant') ai.activate({ x: x * CELL, z: z * CELL });
      ai.pos.set(x * CELL, game.grid.floorY(x * CELL, z * CELL), z * CELL); ai.yaw = yaw;
      game.freezeAI = true;
      ai.m.play(clip, 0, { restart: true });
    },
    // dispara a CENA DE MORTE de verdade (a criatura aparece a ~d m, de frente, e agarra; som incluso). dbg.kill() / dbg.kill(1.4, 1.2)
    kill(d = 1.0, ang = null) {
      const ai = game.ai, p = game.player, g = game.grid;
      if (ai.state === 'dormant') ai.activate({ x: p.pos.x, z: p.pos.z });
      let a = ang;
      if (a == null) { a = Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)); for (let i = 0; i < 16; i++) { const t = a + i * Math.PI / 8, x = p.pos.x + Math.sin(t) * (d + 1), z = p.pos.z + Math.cos(t) * (d + 1); if (g.segmentClear(p.pos.x, p.pos.z, x, z, true)) { a = t; break; } } }
      game.freezeAI = false; game.deathScene.reset();
      ai.pos.set(p.pos.x + Math.sin(a) * d, g.floorY(p.pos.x, p.pos.z), p.pos.z + Math.cos(a) * d); ai.yaw = a + Math.PI;
      ai.m.group.visible = true; ai.visibleModel = true; ai._killed = false;
      ai.tgt = ai.nearestView(); ai.setState('chase'); ai.stateT = 1;
      ai.beginAttack();
      return game.state;
    },
    // simula N segundos sem renderizar (entrada falsa controlavel)
    input: fake(),
    sim(seconds, each) {
      const dt = 1 / 30;
      const n = Math.round(seconds / dt);
      const inp = dbg.input;
      for (let i = 0; i < n; i++) {
        if (each) each(i * dt, inp);
        if (game.state === 'playing' || game.state === 'dying') { game.time += dt; game._update(dt, inp); }
        inp.endFrame();
      }
      return dbg.status();
    },
    // atualiza e renderiza N quadros de forma sincrona (para capturas de tela)
    frame(n = 12) {
      for (let i = 0; i < n; i++) {
        if (game.state === 'playing' || game.state === 'dying') { game.time += 1 / 30; game._update(1 / 30, dbg.input); }
        dbg.input.endFrame();
      }
      game.post.render(game.scene, game.camera, game.time);
      return true;
    },
    // resumo de TODO o estado mutavel: prova que restartRun() volta ao inicio da partida
    digest() {
      const w = game.world, o = game.objectives, p = game.player, ai = game.ai, fl = game.flashlight;
      return JSON.stringify({
        items: w.items.filter(i => !i.parent).map(i => [i.type, i.id, i.taken, i.mesh.visible]), map: w.mapItem.taken,
        drawerFuseTaken: w.drawers.some(d => d.item && d.item.taken),   // o fusivel da gaveta 13 so existe depois de aberta
        drawers: w.drawers.map(d => [d.num, +d.open.toFixed(3), d.target]),
        doors: w.doorsList.map(d => [d.x, d.y, d.locked, d.jammed, d.open, d.target, d.exit, d.padlock?.visible ?? null, d.bar?.visible ?? null]),
        spots: w.hideSpots.map(s => [s.type, s.open || 0, s.target || 0, !!s.compromised]),
        lamps: w.lighting.lamps.map(l => [l.state, l.on]), powered: [...w.lighting.powered].sort(), blackout: w.lighting.blackout,
        obj: { installed: o.installed, charging: o.charging, doorOpen: o.doorOpen, lever: +o.leverPivot.rotation.x.toFixed(2), sockets: o.sockets.map(s => s.fuse.visible) },
        inv: p.inventory, ai: [ai.state, ai.habit, ai.enraged, ai.m.group.visible], dir: [game.director.fuses, game.director.finale, +game.director.menace.toFixed(2)],
        fl: [+fl.battery.toFixed(2), +fl.heat.toFixed(2), +fl.overheat.toFixed(2), fl.on], stats: [game.stats.repels], rain: game.particles.rain.visible, siren: !!game.audio.siren,
        light: Array.from(game.grid.light).reduce((a, v) => a + v, 0).toFixed(3),
      });
    },
    status() {
      const ai = game.ai, p = game.player;
      return {
        state: game.state, mode: game.mode, player: [+(p.pos.x / CELL).toFixed(2), +(p.pos.z / CELL).toFixed(2), +p.pos.y.toFixed(2)],
        creature: ai.state + (ai.sub ? '/' + ai.sub : ''), cpos: [+(ai.pos.x / CELL).toFixed(2), +(ai.pos.z / CELL).toFixed(2)],
        meter: +ai.meter.toFixed(2), dist: +ai.distToPlayer().toFixed(2), exposure: +ai.exposure.toFixed(2), habit: ai.habit,
        battery: +game.flashlight.battery.toFixed(3), heat: +game.flashlight.heat.toFixed(2), fuses: [...game.objectives.installed], carried: [...p.inventory.fuses],
      };
    },
    // olha para um ponto do mundo (celulas)
    look(x, z, y = 1.6) {
      const p = game.player;
      const dx = x * CELL - p.pos.x, dz = z * CELL - p.pos.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(y - (p.pos.y + p.eyeY), Math.hypot(dx, dz));
      sync();
    },
    lookAtCreature() {
      const h = game.ai.m.headWorld(new THREE.Vector3());
      const p = game.player;
      p.yaw = Math.atan2(-(h.x - p.pos.x), -(h.z - p.pos.z));
      p.pitch = Math.atan2(h.y - (p.pos.y + p.eyeY), Math.hypot(h.x - p.pos.x, h.z - p.pos.z));
      sync();
    },
    // interage com o que estiver na mira (como apertar E)
    use() { const t = game.findInteractable(); if (!t) return null; const pr = t.prompt(game); t.use(game); return pr; },
    aimAt(obj) { const v = obj.getWorldPosition(new THREE.Vector3()); dbg.look(v.x / CELL, v.z / CELL, v.y); },
    // posiciona o jogador num ponto livre perto de v (mundo) e mira nele
    standNear(v, r = 1.1) {
      const g = game.grid;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, rr = r * (k < 8 ? 1 : 0.75);
        const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
        const [cx, cz] = g.collideCircle(x, z, 0.32);
        if (Math.hypot(cx - x, cz - z) > 0.01) continue;
        const gx = g.cellX(x), gy = g.cellY(z);
        if (!(g.isFloor(gx, gy) || g.isWallish(gx, gy))) continue;
        if (!g.segmentClear(x, z, v.x, v.z, true, (b) => b.prop)) continue;
        if (Math.abs(g.floorY(x, z) - (v.y - 1)) > 2.5) continue;
        dbg.tp(x / CELL, z / CELL, 0);
        dbg.look(v.x / CELL, v.z / CELL, v.y);
        return true;
      }
      return false;
    },
    async flowTest() {
      const log = [], w = game.world, P = new THREE.Vector3();
      game.freezeAI = true;
      const take = (it) => {
        it.mesh.getWorldPosition(P);
        if (!dbg.standNear(P.clone())) { log.push(`sem lugar perto de ${it.type} ${it.id}`); return false; }
        const t = game.findInteractable();
        const pr = t ? t.prompt(game) : null;
        if (t) t.use(game);
        if (game.state === 'reading') game.closeNote();
        log.push(`${it.type} ${it.id ?? ''}: mira="${pr}" pegou=${it.taken}`);
        return it.taken;
      };
      for (const it of w.items.filter(i => i.type === 'key' || (i.type === 'fuse'))) take(it);
      // gaveta 13
      const d13 = w.drawers.find(d => d.num === 13);
      dbg.standNear(new THREE.Vector3(d13.x, d13.y + 0.8, w.drawerBank.zf + 0.1), 1.2);
      dbg.look(d13.x / CELL, (w.drawerBank.zf + 0.02) / CELL, d13.y);
      const td = game.findInteractable();
      log.push(`gaveta: mira="${td && td.prompt(game)}"`);
      if (td) td.use(game);
      for (let i = 0; i < 40; i++) w.update(0.05);
      if (d13.item) take(d13.item); else log.push('gaveta 13 sem item');
      log.push(`no bolso: ${JSON.stringify(game.player.inventory.fuses)} chave=${game.player.inventory.key}`);
      // quadro geral
      dbg.standNear(game.objectives.pos.clone(), 1.0);
      const tp = game.findInteractable();
      log.push(`quadro: mira="${tp && tp.prompt(game)}"`);
      if (tp) tp.use(game);
      await new Promise(r => setTimeout(r, 3200));
      log.push(`instalados: ${JSON.stringify(game.objectives.installed)}`);
      for (let i = 0; i < 45; i++) game.objectives.holdUpdate(1 / 30, true);
      log.push(`carregando=${game.objectives.charging} blackout=${game.lighting.blackout}`);
      dbg.sim(33);
      log.push(`porta aberta=${game.objectives.doorOpen} carga=${game.objectives.charge.toFixed(2)} estado=${game.state}`);
      const e = w.exitTrigger;
      dbg.tp(e.x / CELL, e.z / CELL - 2.2, Math.PI);
      dbg.input.keys.add('KeyW');
      dbg.sim(2.5);
      dbg.input.keys.delete('KeyW');
      log.push(`fim: estado=${game.state} jogador=${JSON.stringify(dbg.status().player)}`);
      return log;
    },
  };
  return dbg;
}
