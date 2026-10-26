// Particulas: poeira no feixe da lanterna, fumaca da queimadura, faiscas, chuva no patio.
import * as THREE from 'three';

const DUST_VERT = `
uniform vec3 lightPos; uniform vec3 lightDir; uniform float cosA; uniform float on; uniform float range; uniform float time;
attribute float seed;
varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(time * 0.3 + seed * 17.0) * 0.15;
  p.y += sin(time * 0.21 + seed * 9.0) * 0.12;
  p.z += cos(time * 0.27 + seed * 13.0) * 0.15;
  vec3 v = p - lightPos; float d = length(v);
  float c = dot(v / max(d, 1e-3), lightDir);
  vA = on * smoothstep(cosA, mix(cosA, 1.0, 0.5), c) * (1.0 - smoothstep(range * 0.25, range * 0.6, d)) * smoothstep(0.2, 0.8, d);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 2.2 * (6.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vec3(1.0, 0.95, 0.85), a * vA * 0.32); }`;

export class Particles {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    // poeira: nuvem de pontos que segue o jogador
    const N = 600;
    this.dustBox = 9;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * this.dustBox; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = (Math.random() - 0.5) * this.dustBox; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustU = { lightPos: { value: new THREE.Vector3() }, lightDir: { value: new THREE.Vector3(0, 0, -1) }, cosA: { value: 0.9 }, on: { value: 0 }, range: { value: 20 }, time: { value: 0 } };
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.dustCenter = new THREE.Vector3();

    // fumaca / faiscas (sprites reciclados)
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
    this.softTex = new THREE.CanvasTexture(c);
    this.puffs = [];

    // chuva no patio
    const R = 1400;
    const rp = new Float32Array(R * 6);
    this.rainData = rp;
    for (let i = 0; i < R; i++) this._resetDrop(i, true);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x8a96a0, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
  }

  setRainArea(x0, z0, x1, z1) { this.rainArea = [x0, z0, x1, z1]; for (let i = 0; i < this.rainData.length / 6; i++) this._resetDrop(i, true); this.rain.visible = true; }
  _resetDrop(i, randY) {
    const a = this.rainArea || [0, 0, 1, 1];
    const x = a[0] + Math.random() * (a[2] - a[0]), z = a[1] + Math.random() * (a[3] - a[1]);
    const y = randY ? Math.random() * 8 : 8;
    const d = this.rainData;
    d[i * 6] = x; d[i * 6 + 1] = y; d[i * 6 + 2] = z; d[i * 6 + 3] = x + 0.03; d[i * 6 + 4] = y + 0.35; d[i * 6 + 5] = z;
  }

  // fim da partida / reinicio: sem chuva, sem fumaca nem faiscas pendentes
  reset() {
    this.rain.visible = false;
    for (const p of this.puffs) { this.scene.remove(p.s); p.s.material.dispose(); }
    this.puffs.length = 0;
  }

  smokeBurst(p, n = 16) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0x8c8a84, transparent: true, opacity: 0.5, depthWrite: false }));
      s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, Math.random() * 0.1, (Math.random() - 0.5) * 0.2));
      s.scale.setScalar(0.15);
      this.scene.add(s);
      this.puffs.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6), life: 1.6 + Math.random(), age: 0, grow: 0.7 });
    }
  }

  sparks(p, n = 24) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xffd08a, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      s.position.copy(p); s.scale.setScalar(0.05);
      this.scene.add(s);
      this.puffs.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 1.5, (Math.random() - 0.5) * 4), life: 0.5 + Math.random() * 0.6, age: 0, grow: 0, gravity: 9 });
    }
  }

  update(dt, t, flashlight) {
    // poeira recentralizada no jogador
    const cam = this.camera.position;
    if (cam.distanceTo(this.dustCenter) > 2.5) {
      const d = cam.clone().sub(this.dustCenter);
      const pos = this.dust.geometry.attributes.position;
      const half = this.dustBox / 2;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i), z = pos.getZ(i);
        if (x - cam.x > half) x -= this.dustBox; if (cam.x - x > half) x += this.dustBox;
        if (z - cam.z > half) z -= this.dustBox; if (cam.z - z > half) z += this.dustBox;
        pos.setXYZ(i, x, cam.y - 1.5 + ((pos.getY(i) - (this.dustCenter.y - 1.5)) % 3 + 3) % 3, z);
      }
      pos.needsUpdate = true;
      this.dustCenter.copy(cam);
    }
    const b = flashlight.beam();
    this.dustU.lightPos.value.copy(b.pos); this.dustU.lightDir.value.copy(b.dir);
    this.dustU.cosA.value = Math.cos(b.angle); this.dustU.on.value = b.on ? flashlight.flick : 0;
    this.dustU.range.value = b.range; this.dustU.time.value = t;

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.gravity) p.v.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 0.8);
      p.s.scale.addScalar(p.grow * dt);
      p.s.material.opacity = Math.max(0, 1 - p.age / p.life) * (p.gravity ? 1 : 0.45);
      if (p.age >= p.life) { this.scene.remove(p.s); p.s.material.dispose(); this.puffs.splice(i, 1); }
    }

    if (this.rain.visible) {
      const d = this.rainData;
      for (let i = 0; i < d.length / 6; i++) {
        d[i * 6 + 1] -= dt * 11; d[i * 6 + 4] -= dt * 11;
        if (d[i * 6 + 1] < 0) this._resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }
}
