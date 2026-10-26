// Dados de animacao da criatura sem three.js: duracao, velocidade e deslocamento da raiz (root motion) de cada clipe.
// O servidor usa isto para a criatura "andar" exatamente como no cliente (ex.: o recuo ao ser queimada).
export const CREATURE_SCALE = 1.3;
const LEG_STRETCH = 1.17;
export const EFFECTIVE_STRIDE = Math.sqrt(CREATURE_SCALE * LEG_STRETCH);

function decodeInt16(b64, scale) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / scale;
  return out;
}

export class AnimData {
  constructor(json) {
    this.fps = json.fps;
    this.profile = json.guardianMotion || null;
    this.strideScale = this.profile?.profile === 'skinwalker' ? (this.profile.strideScale || 1) : EFFECTIVE_STRIDE;
    this.clips = {};
    for (const [name, info] of Object.entries(json.clips)) {
      if (!info.root) continue;            // clipes procedurais (ex.: shield) nao tem dados
      this.clips[name] = { frames: info.frames, loop: !!info.loop, speed: info.speed || 0, root: decodeInt16(info.root, 1000) };
    }
    this.names = Object.keys(this.clips);
  }
  has(name) { return !!this.clips[name]; }
  duration(name) { const c = this.clips[name]; return c ? (c.frames - (c.loop ? 0 : 1)) / this.fps : 1; }
  clipSpeed(name) { return (this.clips[name]?.speed || 1) * this.strideScale; }
  // deslocamento (m, ja na escala do modelo) da raiz no instante t do clipe
  rootAt(name, t) {
    const c = this.clips[name]; if (!c) return [0, 0];
    const f = Math.min(Math.max(t * this.fps, 0), c.frames - 1);
    const i = Math.floor(f), k = f - i, j = Math.min(c.frames - 1, i + 1);
    const lerp = (a, b) => a + (b - a) * k;
    return [lerp(c.root[i * 3], c.root[j * 3]) * CREATURE_SCALE, lerp(c.root[i * 3 + 2], c.root[j * 3 + 2]) * CREATURE_SCALE];
  }
}
