// Testes do servidor para o "eco de voz" (a criatura imitando quem autorizou): opt-in, limites, reenvio, descarte, sorteio.
// Uso: node tools/test/mimic-server-test.mjs
import { MIMIC } from '../../src/shared/coop.js';
import { ok, section, T, startHub, makeMatch, standNear, sleep } from './harness.mjs';

const ctx = await startHub();
const b64 = (n) => Buffer.alloc(n, 3).toString('base64');       // clipe "falso" (o servidor so guarda e valida tamanho/formato)
const CLIP = b64(24000);
async function optIn(bot, clips = MIMIC.phrases.length) {
  bot.send({ t: 'mimic', op: 'on' });
  for (let i = 0; i < clips; i++) bot.send({ t: 'mimic', op: 'clip', i, sr: 16000, data: CLIP });
  await sleep(120);
}

await section('Sem autorizacao nada e guardado ou tocado', async () => {
  const { bots: [A, B], room, match } = await makeMatch(ctx, 2);
  ok(room.mimicVoices().length === 0, 'ninguem cedeu a voz: lista vazia');
  // clipes sem "on" previo sao ignorados
  A.send({ t: 'mimic', op: 'clip', i: 0, sr: 16000, data: CLIP }); await sleep(100);
  ok(!room.members.get(A.id).mimic, 'clipe sem "on" e ignorado');
  ok(!(await B.tryNext((m) => m.t === 'mimic', 250)), 'os outros nao recebem nada');
  // sorteio nao faz nada sem vozes
  match.mimicT = 0; match.ai.state = 'patrol'; match.ai.visibleModel = true; for (let i = 0; i < 10; i++) match.tick(0.05);
  ok(!(await A.tryNext((m) => m.t === 'mimic' && m.op === 'say', 250)), 'criatura nao fala sem nenhuma voz autorizada');
});

await section('Opt-in, limites e reenvio', async () => {
  const { bots: [A, B, C], room, match } = await makeMatch(ctx, 3);
  await optIn(A);
  ok(room.members.get(A.id).mimic?.clips.size === MIMIC.maxClips, 'A cedeu a voz: 5 clipes guardados');
  const onB = await B.tryNext((m) => m.t === 'mimic' && m.op === 'on' && m.from === A.id, 400);
  ok(!!onB, 'os outros da sala sao avisados de que A cedeu a voz');
  ok(B.peek((m) => m.t === 'mimic' && m.op === 'clip' && m.from === A.id).length === MIMIC.maxClips, 'os outros recebem os 5 clipes (para tocar localmente)');
  ok(!A.peek((m) => m.t === 'mimic' && m.op === 'clip').length, 'o dono nao recebe de volta os proprios clipes na hora');
  // limites: indice invalido, taxa invalida, base64 invalido, tamanho
  const cnt = () => room.members.get(A.id).mimic.clips.size;
  A.send({ t: 'mimic', op: 'clip', i: 9, sr: 16000, data: CLIP }); A.send({ t: 'mimic', op: 'clip', i: -1, sr: 16000, data: CLIP });
  A.send({ t: 'mimic', op: 'clip', i: 0, sr: 44100, data: CLIP }); A.send({ t: 'mimic', op: 'clip', i: 0, sr: 16000, data: '<script>' });
  A.send({ t: 'mimic', op: 'clip', i: 0, sr: 16000, data: 'A'.repeat(MIMIC.maxClipChars + 4) }); A.send({ t: 'mimic', op: 'clip', i: 0, sr: 16000, data: 5 });
  await sleep(150);
  ok(cnt() === 5 && room.members.get(A.id).mimic.clips.get(0).data === CLIP, 'clipes invalidos (indice, taxa, formato, tamanho, tipo) sao recusados sem alterar o que ja existe');
  ok(room.members.get(A.id).mimic.chars <= MIMIC.maxTotalChars, 'total armazenado dentro do limite');
  // quem chega/reconecta depois recebe o que ja foi cedido
  // B sai e volta pela reconexao: recebe de novo
  B.terminate(); await sleep(120);
  const B2 = await ctx.bot('Beto', { token: B.token }); await sleep(250);
  ok(B2.peek((m) => m.t === 'mimic' && m.op === 'clip' && m.from === A.id).length === MIMIC.maxClips, 'jogador que reconecta recebe de novo os clipes cedidos');
  // o proprio dono que recarrega a pagina recebe os proprios clipes (para ouvir a criatura) e sabe que continua ativo
  A.terminate(); await sleep(120);
  const A2 = await ctx.bot('Ana', { token: A.token }); await sleep(250);
  ok(A2.peek((m) => m.t === 'mimic' && m.op === 'on' && m.from === A.id).length === 1 && A2.peek((m) => m.t === 'mimic' && m.op === 'clip' && m.from === A.id).length === 5, 'o dono que reconecta ve que segue ativo e recebe os proprios clipes (pode revogar)');
});

await section('Revogar, sair e fim da partida apagam tudo', async () => {
  const { bots: [A, B, C], room, match } = await makeMatch(ctx, 3);
  await optIn(A); await optIn(B);
  ok(room.mimicVoices().length === 2, 'duas vozes cedidas');
  // revogar
  A.send({ t: 'mimic', op: 'off' }); await sleep(120);
  ok(!room.members.get(A.id).mimic && room.mimicVoices().length === 1, 'revogar apaga os clipes de A no servidor');
  ok(!!(await C.tryNext((m) => m.t === 'mimic' && m.op === 'gone' && m.from === A.id, 300)), 'os outros sao avisados para descartar a voz de A');
  // sair da sala
  B.send({ t: 'leave' }); await sleep(150);
  ok(room.mimicVoices().length === 0, 'sair da sala apaga os clipes de B');
  ok(!!(await C.tryNext((m) => m.t === 'mimic' && m.op === 'gone' && m.from === B.id, 300)), 'os outros sao avisados (B saiu)');
  // fim da partida
  await optIn(C);
  ok(room.mimicVoices().length === 1, 'C cedeu a voz');
  match.end('lost'); await sleep(300);
  ok(room.mimicVoices().length === 0 && ![...room.members.values()].some(p => p.mimic), 'fim da partida apaga todas as vozes');
  const g = await A.tryNext((m) => m.t === 'mimic' && m.op === 'gone' && m.from === C.id, 300);
  ok(!!g, 'clientes sao avisados para descartar no fim da partida');
});

await section('Sala destruida nao deixa vozes para tras', async () => {
  const { bots: [A, B], room, code } = await makeMatch(ctx, 2);
  await optIn(A);
  const members = [...room.members.values()];
  A.send({ t: 'leave' }); B.send({ t: 'leave' }); await sleep(250);
  ok(!ctx.hub.rooms.has(code), 'sala vazia foi destruida');
  ok(members.every(p => !p.mimic), 'nenhum jogador manteve clipes apos a sala fechar');
});

await section('Sorteio das falas: so quando permitido e sempre pelo servidor', async () => {
  const { bots: [A, B, C], room, match } = await makeMatch(ctx, 3);
  const pA = match.players.get(A.id), pB = match.players.get(B.id), pC = match.players.get(C.id);
  await optIn(A);
  const ai = match.ai, g = match.grid;
  // mantem todos longe da criatura e a criatura em patrulha
  const place = (p, x, z) => { p.pos.set(x, g.floorY(x, z), z); p.updateEye(); };
  const cx = g.cx(30), cz = g.cz(30);
  const arm = (state, dist = 20) => {
    ai.hardReset(); ai.activate(match.world.creatureSpawn); ai.pos.set(cx, 0, cz); ai.m.group.position.copy(ai.pos); ai.setState(state); ai.visibleModel = true;
    place(pA, cx + dist, cz); place(pB, cx + dist + 3, cz); place(pC, cx + dist + 6, cz);
    match.mimicT = 0; match.lastMimic = -99;
  };
  const say = async () => B.tryNext((m) => m.t === 'mimic' && m.op === 'say', 200);
  const stepOnce = () => { match._tickMimic(0.05); };
  // estados em que ela caca/ataca: nunca fala
  for (const st of ['chase', 'attack', 'flee', 'stunned']) { arm(st); stepOnce(); ok(!(await say()), `nao fala no estado "${st}"`); }
  // muito perto de alguem: nao fala
  arm('patrol', 2); stepOnce(); ok(!(await say()), 'nao fala colada em um jogador (< ' + MIMIC.minPlayerDist + ' m)');
  // patrulha e longe: fala uma das frases do dono, na posicao da criatura
  arm('patrol'); stepOnce();
  const m1 = await say();
  ok(!!m1 && m1.from === A.id && m1.i >= 0 && m1.i < MIMIC.phrases.length, 'em patrulha e longe: fala com a voz de quem autorizou (A)');
  const head = ai.m.headWorld(new (pA.eye.constructor)());
  ok(m1 && Math.abs(m1.x - head.x) < 0.02 && Math.abs(m1.z - head.z) < 0.02 && Math.abs(m1.y - head.y) < 0.02 && Math.hypot(m1.x - ai.pos.x, m1.z - ai.pos.z) < 1.5, 'a fala sai da cabeca da criatura (posicao calculada no servidor)');
  ok(A.peek((m) => m.t === 'mimic' && m.op === 'say').length === 1, 'o proprio dono tambem recebe (a criatura fala com a voz dele para todos)');
  // intervalo minimo entre falas
  match.mimicT = 0; stepOnce(); ok(!(await say()), 'nao repete em sequencia (intervalo minimo de ' + MIMIC.minGap + ' s)');
  ok(match.mimicT > 0, 'o proximo sorteio foi reagendado');
  // frase que pressupoe fusivel no mapa nao sai quando todos foram instalados
  for (const it of match.items.values()) if (it.type === 'fuse') it.state = 'installed';
  const seen = new Set();
  for (let k = 0; k < 40; k++) { arm('patrol'); match.lastMimic = -99; match._lastPhrase = -1; stepOnce(); const s = await B.tryNext((m) => m.t === 'mimic' && m.op === 'say', 30); if (s) seen.add(s.i); }
  ok(seen.size > 1 && !seen.has(0), 'com todos os fusiveis instalados, a frase "Achei um fusivel" nao sai; as outras variam', [...seen].join());
  // morto nao interfere: dono morto continua sendo a fonte, mas quem morre nao posiciona nem dispara nada
  // mensagens "say" enviadas por um cliente sao ignoradas
  const before = B.peek((m) => m.t === 'mimic' && m.op === 'say').length;
  A.send({ t: 'mimic', op: 'say', from: A.id, i: 1, x: 0, y: 1, z: 0 }); C.send({ t: 'mimic', op: 'say', i: 2 }); await sleep(150);
  ok(B.peek((m) => m.t === 'mimic' && m.op === 'say').length === before, 'cliente nao consegue forcar a criatura a falar');
});

await section('Vozes de salas diferentes nao se misturam', async () => {
  const r1 = await makeMatch(ctx, 2, ['Ana', 'Beto']), r2 = await makeMatch(ctx, 2, ['Cida', 'Davi']);
  await optIn(r1.bots[0]);
  await sleep(120);
  ok(r2.bots.every(b => !b.peek((m) => m.t === 'mimic').length), 'sala 2 nao recebe nada da sala 1');
  ok(r2.room.mimicVoices().length === 0 && r1.room.mimicVoices().length === 1, 'armazenamento separado por sala');
});

console.log(`\nResultado: ${T.pass} ok, ${T.fail} falhas`);
await ctx.stop();
process.exit(T.fail ? 1 : 0);
