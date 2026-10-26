// QA visual dos modelos 3D no painel do navegador (console), com o jogo aberto em http://localhost:8765/?debug :
//   const q = await import('/tools/test/models-qa.js?v=' + Date.now()); await q.install();
//   inspect('hospital_bed')          -> desenha o modelo ja normalizado (yaw/escala do manifesto): vista 3/4 + vista de cima, com os eixos do jogo
//                                       (X vermelho, Y verde, Z azul; a bolinha azul fica em +Z = FRENTE do jogo)
//   viewModel('gurney', 0)           -> leva o jogador ate a instancia N do modelo dentro do mundo (luzes ligadas) e renderiza
// So olha: nao altera o jogo nem os arquivos.
import { boot, THREE } from './browser-helpers.js';

export async function install() {
  const g = await boot();
  g._frame = () => {};                         // painel "hidden": o laco normal nao e confiavel; renderizamos na mao
  const T = THREE, r = g.renderer, C = 1.25;
  window.inspect = (id, extraYaw = 0) => {
    const t = g.models?.templates.get(id);
    if (!t) return 'sem modelo ' + id;
    const sc = new T.Scene(); sc.background = new T.Color(0x3a3d3c);
    sc.add(new T.HemisphereLight(0xffffff, 0x445544, 1.6));
    const dl = new T.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 4, 3); sc.add(dl);
    const m = t.pivot.clone(true); m.rotation.y = T.MathUtils.degToRad(extraYaw); sc.add(m);
    sc.add(new T.AxesHelper(1.2)); sc.add(new T.GridHelper(4, 16, 0x888888, 0x555555));
    const dot = new T.Mesh(new T.SphereGeometry(0.06), new T.MeshBasicMaterial({ color: 0x3377ff })); dot.position.set(0, 0.05, 1.3); sc.add(dot);
    const box = new T.Box3().setFromObject(m), size = box.getSize(new T.Vector3());
    const W = r.domElement.width, H = r.domElement.height, auto = r.autoClear;
    r.autoClear = true; r.setScissorTest(true); r.setRenderTarget(null);
    const cam1 = new T.PerspectiveCamera(40, (W / 2) / H, 0.1, 50); cam1.position.set(2.6, 1.9, 2.8); cam1.lookAt(0, Math.min(0.6, size.y / 2), 0);
    const hh = 1.6 * H / (W / 2);
    const cam2 = new T.OrthographicCamera(-1.6, 1.6, hh, -hh, 0.1, 50); cam2.position.set(0, 10, 0); cam2.up.set(0, 0, -1); cam2.lookAt(0, 0, 0);
    for (const [cam, x] of [[cam1, 0], [cam2, W / 2]]) { r.setViewport(x, 0, W / 2, H); r.setScissor(x, 0, W / 2, H); r.render(sc, cam); }
    r.setScissorTest(false); r.setViewport(0, 0, W, H); r.autoClear = auto;
    return JSON.stringify({ id, dims: size.toArray().map(v => +v.toFixed(2)), min: box.min.toArray().map(v => +v.toFixed(2)), spec: t.spec });
  };
  window.viewModel = (id, idx = 0, dist = 2.4, up = 0.6) => {
    const list = []; g.scene.traverse(o => { if (o.userData && o.userData.model3d === id) list.push(o); });
    const o = list[idx]; if (!o) return 'nenhuma instancia de ' + id;
    const p = o.getWorldPosition(new T.Vector3()); p.y += up;
    window.dbg.lights(true); g.freezeAI = true;
    const ok = window.dbg.standNear(p, dist);
    window.dbg.look(p.x / C, p.z / C, p.y);
    window.dbg.frame(3);
    return JSON.stringify({ ok, instancias: list.length, em: [+p.x.toFixed(1), +p.z.toFixed(1)], giro: +o.rotation.y.toFixed(2) });
  };
  window.T3 = T;
  return g.models ? [...g.models.templates.keys()] : 'sem biblioteca de modelos';
}
