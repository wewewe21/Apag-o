// Interface do "eco de voz": bloco no lobby, janela de consentimento/gravacao e botao de revogar no menu de pausa.
// O consentimento e ESPECIFICO desta funcao (a permissao do microfone para o chat de voz nao vale aqui) e precisa de um clique deliberado.
import { MimicClient } from './mimic.js';

const $ = (id) => document.getElementById(id);
const mb = (b) => (b / 1e6).toFixed(0);

export class MimicUi {
  constructor() {
    this.client = null;            // preenchido por bind()
    this.step = 'off';
    this._wired = false;
  }

  // chamado pelo OnlineController depois de criar o MimicClient
  bind(client) {
    this.client = client;
    const supported = client.supported;
    $('mmBox').hidden = !supported;
    if (this._wired) return; this._wired = true;
    $('mmOpen').onclick = () => this.openConsent();
    $('mmAgree').onchange = () => { $('mmYes').disabled = !$('mmAgree').checked; };
    $('mmNo').onclick = () => this.close();
    $('mmYes').onclick = () => { if (!$('mmAgree').checked) return; this._show('work'); this.client.run(); };
    $('mmRec').onclick = () => this.client.beginRecording();
    $('mmStop').onclick = () => this.client.stopRecording();
    $('mmCancel').onclick = () => { this.client.cancel(); this.close(); };
    $('mmClose').onclick = () => this.close();
    for (const id of ['mmRevoke', 'mmRevokePause']) $(id).onclick = () => { this.client.revoke(true); this.refresh(); };
  }

  openConsent() {
    $('mmAgree').checked = false; $('mmYes').disabled = true;
    this._show('consent'); $('mimicModal').hidden = false;
    $('mmAgree').focus();
  }
  close() { $('mimicModal').hidden = true; this.refresh(); }
  _show(which) { $('mmConsent').hidden = which !== 'consent'; $('mmWork').hidden = which !== 'work'; $('mimicModal').hidden = false; }

  // chamado pelo MimicClient a cada mudanca de etapa
  set(step, info = {}) {
    this.step = step;
    const work = () => { if ($('mimicModal').hidden || !$('mmConsent').hidden) this._show('work'); };
    const setBtns = (rec, stop, cancel, close) => { $('mmRec').hidden = !rec; $('mmStop').hidden = !stop; $('mmCancel').hidden = !cancel; $('mmClose').hidden = !close; };
    const prog = (v) => { $('mmProg').hidden = v == null; if (v != null) $('mmProg').value = Math.max(0, Math.min(1, v)); };
    const sentence = (t) => { $('mmText').hidden = !t; $('mmText').textContent = t || ''; };
    if (step === 'downloading') {
      if ($('mimicModal').hidden) return;
      work(); $('mmTitle').textContent = 'Baixando o modelo de voz';
      $('mmMsg').textContent = info.total ? `${mb(info.loaded)} de ~${mb(info.total)} MB. Só na primeira vez: o navegador guarda o modelo. Sua voz não é enviada a ninguém.` : 'Preparando…';
      prog(info.total ? info.loaded / info.total : 0); sentence(''); setBtns(false, false, true, false); $('mmWarn').textContent = '';
    } else if (step === 'recording') {
      if ($('mimicModal').hidden) return;
      work(); prog(null); sentence(info.text);
      $('mmWarn').textContent = info.warn || '';
      if (info.live) { $('mmTitle').textContent = 'Gravando… leia a frase em voz normal'; $('mmMsg').textContent = 'Aperte “Parar” quando terminar (para sozinho em ' + (info.maxSec || 14) + ' s).'; setBtns(false, true, true, false); }
      else { $('mmTitle').textContent = info.attempt ? 'Vamos tentar de novo' : 'Grave uma amostra da sua voz'; $('mmMsg').textContent = 'Use fones e um lugar silencioso. Ao apertar “Gravar” o navegador pode pedir acesso ao microfone. A gravação fica só neste navegador e é apagada assim que as falas são criadas.'; setBtns(true, false, true, false); }
    } else if (step === 'processing' || step === 'uploading') {
      if ($('mimicModal').hidden) return;
      work(); $('mmTitle').textContent = 'Criando as falas da criatura'; $('mmMsg').textContent = info.msg || ''; sentence(''); $('mmWarn').textContent = '';
      prog(info.total ? (info.done || 0) / info.total : null); setBtns(false, false, true, false);
    } else if (step === 'ready') {
      work(); $('mmTitle').textContent = 'Pronto'; sentence(''); prog(null); $('mmWarn').textContent = '';
      $('mmMsg').textContent = `Feito em ${Math.round(info.seconds || 0)} s. A criatura poderá dizer frases curtas com uma voz parecida com a sua, nesta partida. Você pode revogar quando quiser; ao fim da partida tudo é apagado.`;
      setBtns(false, false, false, true);
    } else if (step === 'error') {
      work(); $('mmTitle').textContent = 'Recurso desligado'; sentence(''); prog(null); $('mmWarn').textContent = ''; $('mmMsg').textContent = info.msg || 'Não foi possível.'; setBtns(false, false, false, true);
    } else if (step === 'off') {
      if (!$('mmWork').hidden) $('mimicModal').hidden = true;
    }
    this.refresh();
  }

  // texto do bloco do lobby / botao de revogar
  refresh() {
    const c = this.client; if (!c) return;
    const mine = c.owners.has(c.me);
    const others = [...c.owners].filter(id => id !== c.me).length;
    $('mmOpen').hidden = mine || ['downloading', 'recording', 'processing', 'uploading'].includes(c.state);
    $('mmRevoke').hidden = !mine;
    $('mmRevokePause').hidden = !mine;
    $('mmPause').hidden = !mine;
    let s = 'Desligado. Só entra em ação se você autorizar.';
    if (['downloading', 'recording', 'processing', 'uploading'].includes(c.state)) s = 'Preparando sua voz…';
    else if (mine) s = 'Ativo: a criatura pode imitar a sua voz até o fim desta partida.';
    if (others) s += ` ${others} outro(s) jogador(es) também cederam a voz.`;
    $('mmState').textContent = s;
    $('mmState').className = 'status' + (mine ? ' ok' : '');
  }
}

export { MimicClient };
