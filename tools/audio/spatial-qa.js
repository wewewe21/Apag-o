import { AudioLibrary } from '../../src/core/audio-library.js';

// Renderiza a rota do jogo com HRTF real, sem música ou ambiente mascarando os canais.
export async function spatialProbe(buffer, { x = 3, y = 0.12, z = -3, yaw = 0, blocked = false } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil((buffer.duration + 0.3) * 48000), 48000);
  const cam = { position: { x: 0, y: 1.7, z: 0 } };
  const listener = ctx.listener;
  listener.positionY.value = 1.7;
  listener.forwardX.value = -Math.sin(yaw); listener.forwardY.value = 0; listener.forwardZ.value = -Math.cos(yaw);
  listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
  const dry = ctx.createGain(); dry.connect(ctx.destination);
  const host = { ctx, dry, revSend: ctx.createGain(), game: { camera: cam, grid: { segmentClear: () => !blocked } } };
  const library = Object.assign(Object.create(AudioLibrary.prototype), { ctx, host });
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer; source.connect(gain);
  library._route(gain, { pos: { x, y, z }, ref: 3.2, rolloff: 0.85, reverb: 0 });
  source.start(0.04);
  const rendered = await ctx.startRendering();
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  let l = 0, r = 0, difference = 0;
  for (let i = 0; i < left.length; i++) { l += left[i] * left[i]; r += right[i] * right[i]; difference += (left[i] - right[i]) ** 2; }
  return { left: Math.sqrt(l / left.length), right: Math.sqrt(r / right.length), rms: Math.sqrt((l + r) / (2 * left.length)), difference: Math.sqrt(difference / left.length), samples: left };
}

export async function verifySpatial(buffer, check, report) {
  const left = await spatialProbe(buffer, { x: -3 });
  const right = await spatialProbe(buffer, { x: 3 });
  check(left.left > left.right * 1.15 && right.right > right.left * 1.15, 'HRTF separa esquerda/direita');
  const turned = await spatialProbe(buffer, { x: 3, yaw: Math.PI });
  check(turned.left > turned.right * 1.15, 'virar a cabeça inverte a direção percebida');
  const front = await spatialProbe(buffer, { x: 0, z: -3 });
  const back = await spatialProbe(buffer, { x: 0, z: 3 });
  const delta = Math.sqrt(front.samples.reduce((n, v, i) => n + (v - back.samples[i]) ** 2, 0) / front.samples.length);
  check(delta > front.rms * 0.03, 'HRTF produz respostas diferentes para frente/trás');
  const far = await spatialProbe(buffer, { x: 18, z: -18 });
  const wall = await spatialProbe(buffer, { blocked: true });
  check(far.rms < right.rms * 0.35, 'distância reduz a intensidade');
  check(wall.rms < right.rms * 0.65, 'parede abafa o passo');
  report(`HRTF: direita ${(right.right / right.left).toFixed(2)}×; distante ${(far.rms / right.rms).toFixed(2)}×; parede ${(wall.rms / right.rms).toFixed(2)}×.`);
}
