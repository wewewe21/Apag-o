// Telas do modo Online (menu, lobby, fim de partida) e faixa de estado da conexao. So DOM: a logica fica em online.js.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const NAME_KEY = 'apagao.name.v1';

export class OnlineUI {
  constructor(h) {
    this.h = h;    // { create(name), join(code, name), refresh(), back(), ready(on), start(), leave(), endBack() }
    const nm = $('onName');
    try { nm.value = localStorage.getItem(NAME_KEY) || ''; } catch { /* sem storage */ }
    $('onCreate').onclick = () => h.create(this.name());
    $('onJoin').onclick = () => h.join($('onCode').value, this.name());
    $('onCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('onCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') h.join($('onCode').value, this.name()); });
    $('onRefresh').onclick = () => h.refresh();
    $('onBack').onclick = () => h.back();
    $('lbReady').onclick = () => h.ready(!this.myReady);
    $('lbStart').onclick = () => h.start();
    $('lbLeave').onclick = () => h.leave();
    $('endBack').onclick = () => h.endBack();
    this.myReady = false;
  }

  name() {
    const n = $('onName').value.trim().slice(0, 16);
    try { localStorage.setItem(NAME_KEY, n); } catch { /* ok */ }
    return n;
  }

  // faixa fixa no topo: conexao / espera / reconexao / indisponibilidade
  banner(text, kind = '') { const b = $('netBanner'); if (!text) { b.hidden = true; return; } b.hidden = false; b.textContent = text; b.className = kind; }

  showMenu(show = true) { $('online').hidden = !show; if (show) { $('title').hidden = true; } }
  showLobby(show = true) { $('lobby').hidden = !show; }
  status(text, kind = '') { const e = $('onStatus'); e.textContent = text || ''; e.className = 'status ' + kind; }
  lobbyStatus(text, kind = '') { const e = $('lbStatus'); e.textContent = text || ''; e.className = 'status ' + kind; }
  enableMenu(on) { for (const id of ['onCreate', 'onJoin', 'onRefresh']) $(id).disabled = !on; }

  rooms(list) {
    const ul = $('onRooms');
    if (!list.length) { ul.innerHTML = '<li class="empty">Nenhuma sala aberta agora. Crie uma!</li>'; return; }
    ul.innerHTML = list.map(r => {
      const joinable = r.phase === 'lobby' && r.count < r.max;
      const st = r.phase === 'lobby' ? (r.count >= r.max ? 'cheia' : 'aguardando') : 'em partida';
      return `<li><span class="code">${esc(r.code)}</span><span>${esc(r.name)} <span style="color:var(--dim)">· ${esc(r.host)}</span></span><span>${r.count}/${r.max} · ${st}</span><button data-code="${esc(r.code)}" ${joinable ? '' : 'disabled'}>Entrar</button></li>`;
    }).join('');
    ul.querySelectorAll('button[data-code]').forEach(b => { b.onclick = () => this.h.join(b.dataset.code, this.name()); });
  }

  lobby(room, meId) {
    $('lbTitle').textContent = room.name;
    $('lbCode').textContent = room.code;
    const isHost = room.host === meId;
    const me = room.members.find(m => m.id === meId);
    this.myReady = !!me?.ready;
    $('lbSub').textContent = `${room.members.length}/${room.max} jogadores · ${isHost ? 'você é o criador da sala' : 'aguardando o criador iniciar'}`;
    $('lbMembers').innerHTML = room.members.map(m => {
      const tag = m.id === room.host ? 'criador' : m.online ? (m.ready ? 'pronto' : 'aguardando') : 'sem conexão';
      return `<li><span class="dot ${m.online ? (m.ready || m.id === room.host ? 'ready' : '') : 'off'}"></span><span>${esc(m.name)}${m.id === meId ? ' <span style="color:var(--dim)">(você)</span>' : ''}</span><span class="tag">${tag}</span></li>`;
    }).join('');
    $('lbReady').hidden = isHost;
    $('lbReady').textContent = this.myReady ? 'Não estou pronto' : 'Estou pronto';
    $('lbStart').hidden = !isHost;
    const waiting = room.members.filter(m => m.id !== room.host && m.online && !m.ready).length;
    $('lbStart').disabled = false;
    $('lbStart').textContent = waiting ? `Iniciar (${waiting} ainda não pronto${waiting > 1 ? 's' : ''})` : 'Iniciar partida';
    if (room.result) {
      const r = room.result;
      const txt = r.result === 'win' ? `Última rodada: VITÓRIA — ${r.stats.escaped}/${r.stats.players} escaparam, ${r.stats.fuses} fusíveis.` : r.result === 'lose' ? 'Última rodada: DERROTA — todos morreram.' : 'Última rodada encerrada.';
      this.lobbyStatus(txt, r.result === 'win' ? 'ok' : 'err');
    }
  }

  end(result, stats, players, meId) {
    const win = result === 'win';
    $('endTitle').textContent = win ? 'VOCÊS SAÍRAM' : 'NINGUÉM SOBREVIVEU';
    $('endTitle').style.color = win ? 'var(--green)' : '#c9372a';
    $('endText').textContent = win ? `${stats.escaped} de ${stats.players} jogadores escaparam do Santa Lúcia.` : 'O Noturno pegou todos. O prédio volta a ficar em silêncio... por enquanto.';
    const mm = Math.floor(stats.time / 60), ss = String(stats.time % 60).padStart(2, '0');
    $('endStats').innerHTML = `<div><dt>Tempo</dt><dd>${mm}:${ss}</dd></div><div><dt>Fusíveis</dt><dd>${stats.fuses}/7</dd></div><div><dt>Mortes</dt><dd>${stats.deaths}</dd></div><div><dt>Vezes que o queimaram</dt><dd>${stats.repels}</dd></div>`;
    $('endStats').querySelectorAll('dt').forEach(e => { e.style.cssText = 'font:500 13px var(--ui);letter-spacing:.2em;text-transform:uppercase;opacity:.7'; });
    $('endStats').querySelectorAll('dd').forEach(e => { e.style.cssText = 'margin:6px 0 0;font:400 30px var(--display)'; });
    const label = { escaped: 'escapou', dead: 'morreu', alive: 'vivo', left: 'saiu' };
    $('endPlayers').innerHTML = players.map(p => `<li>${esc(p.name)}${p.id === meId ? ' (você)' : ''} — ${label[p.status] || p.status}</li>`).join('');
    $('endScreen').hidden = false;
  }
  hideEnd() { $('endScreen').hidden = true; }
}
