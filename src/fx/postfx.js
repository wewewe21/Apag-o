// Pos-processamento proprio (sem addons): granulacao, vinheta, aberracao cromatica
// com o medo, gradacao de cor fria e pulso vermelho de dano/susto.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 res; uniform float time;
uniform float fear; uniform float pulse; uniform float grain; uniform float blackout; uniform float hideMask;
uniform float burn; uniform float fade; uniform vec3 fadeColor; uniform float adapt; uniform float ghost;
uniform float paranoia;
uniform float shock; uniform float flash; uniform vec3 flashColor; uniform float tunnel;   // cena de morte (0 = desligado)
varying vec2 vUv;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r = length(c);
  // distorcao sutil com o medo
  uv += c * r * r * fear * 0.06 * sin(time * 1.7);
  float ca = 0.0015 + fear * 0.006 + pulse * 0.01;
  vec3 col;
  if (shock > 0.002) {
    // pancada: borrao radial para o centro com aberracao cromatica forte
    float cs = ca + shock * 0.02;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      vec2 us = uv - c * shock * 0.07 * (float(i) / 6.0);
      acc.r += texture2D(tDiffuse, us + c * cs).r;
      acc.g += texture2D(tDiffuse, us).g;
      acc.b += texture2D(tDiffuse, us - c * cs).b;
    }
    col = acc / 7.0;
  } else {
    col.r = texture2D(tDiffuse, uv + c * ca).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - c * ca).b;
  }
  #ifdef TONE_MAPPING
  col = toneMapping(col);
  #endif
  // gradacao: sombras frias esverdeadas, realces levemente quentes
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), 0.18 + fear * 0.25);
  col += vec3(-0.004, 0.006, 0.008) * (1.0 - smoothstep(0.0, 0.25, l));
  col *= vec3(0.97, 1.0, 1.02);
  // vinheta
  float vig = smoothstep(0.85, 0.25, r * (1.0 + fear * 0.35));
  col *= mix(0.35, 1.0, vig);
  // Escuro prolongado: a periferia fecha aos poucos; o centro continua navegável.
  float paranoiaEdge = smoothstep(0.22, 0.65, length((vUv - 0.5) * vec2(1.0, 0.9)));
  float paranoiaAmount = clamp(paranoia, 0.0, 1.0) * paranoiaEdge * (1.0 - ghost);
  col *= 1.0 - paranoiaAmount * 0.28;
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), paranoiaAmount * 0.12);
  // pulso vermelho
  col = mix(col, vec3(0.35, 0.0, 0.0) + col * 0.6, pulse * smoothstep(0.1, 0.7, r));
  // esconderijo: no armario as frestas sao geometria real da porta; aqui so o "olho se acostumando ao escuro"
  // e uma vinheta de caixa fechada
  if (hideMask > 0.5) {
    col *= mix(0.6, 1.0, smoothstep(0.95, 0.4, r)) * (1.0 + adapt * 1.15);
    col += vec3(0.004, 0.006, 0.006) * adapt;
  } else if (hideMask > 0.1) {
    // embaixo da cama: colchao escuro em cima
    float top = smoothstep(0.62, 0.52, vUv.y);
    col *= mix(0.05, 1.0, top);
  }
  // espirito: mundo desbotado, azulado e um pouco mais claro (enxerga melhor que os vivos)
  if (ghost > 0.001) {
    float gl = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(gl) * vec3(0.72, 0.9, 1.12) * 2.6 + vec3(0.012, 0.022, 0.034), ghost * 0.78);
  }
  // clarao do foco queimando
  col += vec3(1.0, 0.95, 0.85) * burn * 0.25 * smoothstep(0.5, 0.0, r);
  // morte: visao em tunel (a periferia fecha e esfria para um vermelho sujo) e clarao da pancada
  if (tunnel > 0.001) {
    float tl = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(tl) * vec3(1.0, 0.8, 0.76), tunnel * 0.35);
    col *= mix(1.0, smoothstep(0.95 - tunnel * 0.55, 0.12, r), tunnel);
  }
  col += flashColor * flash;
  // granulacao
  float n = hash(vUv * res + fract(time * 13.0) * 100.0);
  col += (n - 0.5) * grain * (0.6 + fear);
  col *= 1.0 - blackout;
  col = mix(col, fadeColor, fade);
  gl_FragColor = linearToOutputTexel(vec4(max(col, 0.0), 1.0));
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.uniforms = {
      tDiffuse: { value: this.rt.texture }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
      fear: { value: 0 }, pulse: { value: 0 }, grain: { value: 0.05 }, blackout: { value: 0 }, hideMask: { value: 0 }, adapt: { value: 0 }, ghost: { value: 0 },
      burn: { value: 0 }, fade: { value: 0 }, fadeColor: { value: new THREE.Color(0, 0, 0) },
      paranoia: { value: 0 },
      shock: { value: 0 }, flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 0.86, 0.8) }, tunnel: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h, scale) {
    this.rt.setSize(Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale)));
    this.uniforms.res.value.set(w, h);
  }
  render(scene, camera, t) {
    this.uniforms.time.value = t;
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
