// Checkpoint simples em localStorage (tudo em try/catch: pode estar bloqueado).
const KEY = 'apagao.save.v1';
const PREFS = 'apagao.prefs.v1';

export function loadSave() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sem armazenamento */ }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
}
export function loadPrefs() {
  try { return { sens: 1, volume: 0.8, quality: 'medium', invertY: false, ...(JSON.parse(localStorage.getItem(PREFS)) || {}) }; }
  catch { return { sens: 1, volume: 0.8, quality: 'medium', invertY: false }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sem armazenamento */ }
}
