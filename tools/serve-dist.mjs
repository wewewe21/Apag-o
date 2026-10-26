// Serve a pasta dist/ como o GitHub Pages faria, inclusive em SUBPASTA (https://usuario.github.io/nome-do-repo/).
//   node tools/serve-dist.mjs                       -> http://localhost:9090/
//   node tools/serve-dist.mjs --base=/apagao/ --port=9090   -> http://localhost:9090/apagao/
// Serve so arquivos de dentro de dist/ (sem .., sem arquivos que comecam com ponto exceto .nojekyll).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const DIR = path.resolve(arg('dir', path.join(ROOT, 'dist')));
const PORT = +arg('port', 9090);
let BASE = arg('base', '/'); if (!BASE.startsWith('/')) BASE = '/' + BASE; if (!BASE.endsWith('/')) BASE += '/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE)) { res.writeHead(404); return res.end('fora da base ' + BASE); }
  p = p.slice(BASE.length);
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = path.resolve(DIR, p);
  const hidden = p.split('/').some(s => s.startsWith('.') && s !== '.nojekyll');
  if (!file.startsWith(DIR + path.sep) || hidden) { res.writeHead(404); return res.end('nao encontrado'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404 ' + p); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`dist em http://localhost:${PORT}${BASE}  (pasta ${DIR})`));
