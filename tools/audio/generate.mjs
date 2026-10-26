import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CATALOG, filenames } from './catalog.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'assets', 'audio');
export const hash = (data) => createHash('sha256').update(data).digest('hex');
export function parseEnv(text) {
  const match = text.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/m);
  return match ? match[1].replace(/^(['"])(.*)\1$/, '$2').trim() : '';
}
export function requireKey(key) {
  if (!/^sk_[A-Za-z0-9_-]+$/.test(key || '')) throw new Error('Chave secreta ausente ou inválida. Defina ELEVENLABS_API_KEY com a chave que começa com sk_. Um ID de chave não autentica a API.');
  return key;
}
async function credential() {
  if (process.env.ELEVENLABS_API_KEY) return requireKey(process.env.ELEVENLABS_API_KEY.trim());
  for (const name of ['.env.local', '.env']) {
    try { const value = parseEnv(await readFile(path.join(ROOT, name), 'utf8')); if (value) return requireKey(value); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return requireKey('');
}
export async function api(url, key, body, request = fetch) {
  // Só erros explícitos de rate limit são repetidos. Falha de transporte não
  // dispara outra geração cobrada cujo resultado anterior pode ter sido criado.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await request('https://api.elevenlabs.io/v1/' + url, {
      method: body ? 'POST' : 'GET',
      headers: { 'xi-api-key': requireKey(key), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(body ? 900_000 : 30_000),
    });
    if (response.ok) return response;
    let detail = {};
    try { detail = (await response.json()).detail || {}; } catch { /* erro sem JSON */ }
    if (response.status === 429 && attempt < 3) {
      const seconds = Math.min(60, Math.max(1, Number(response.headers.get('retry-after')) || 6 * (attempt + 1)));
      await new Promise(r => setTimeout(r, seconds * 1000));
      continue;
    }
    const code = String(detail.code || detail.status || 'request_failed').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 90);
    const safe = String(detail.message || 'Pedido recusado pelo ElevenLabs.').split(key).join('[redacted]').replace(/sk_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 350);
    throw new Error(`ElevenLabs HTTP ${response.status} (${code}): ${safe}`);
  }
}
function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${program}: ${result.error?.message || result.stderr?.slice(-1500) || 'falha'}`);
  return result;
}
export function probe(file) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).stdout);
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function atomic(file, data) { await writeFile(file + '.partial', data); await rename(file + '.partial', file); }
export function bodyFor(asset, variant) {
  const prompt = asset.prompt + (asset.variants > 1 ? asset.footstep ? ` Natural take ${variant + 1}.` : ` Performance variant ${variant + 1}, with subtle natural timbral variation. Preserve the same identity, tempo and immediate onset.` : '');
  if (asset.type !== 'music' && prompt.length > 450) throw new Error(`Prompt de efeito excede 450 caracteres: ${asset.id}`);
  return asset.type === 'music'
    ? { prompt, music_length_ms: Math.round(asset.seconds * 1000), model_id: 'music_v2_5', force_instrumental: true }
    : { text: prompt, duration_seconds: asset.seconds, prompt_influence: asset.promptInfluence ?? 0.55, loop: asset.loop, model_id: 'eleven_text_to_sound_v2' };
}
function normalize(raw, output, asset) {
  const target = asset.targetLufs ?? (asset.type === 'music' ? -23 : asset.type === 'ambience' ? -27 : ['stinger', 'death'].includes(asset.id) ? -18 : -20);
  // Foley começa imediatamente; camas e música conservam suas fronteiras.
  const trim = !asset.loop && asset.type !== 'music' ? 'silenceremove=start_periods=1:start_duration=0.015:start_threshold=-48dB:start_silence=0.008,' : '';
  const foley = asset.footstep ? `${asset.mono ? 'aformat=channel_layouts=mono,' : ''}highpass=f=${asset.type === 'foley' ? 90 : 45},lowpass=f=10000,` : '';
  // Foley pode vir muito baixo: medir primeiro evita confundir contato suave com silêncio.
  let prepare = foley;
  if (asset.footstep) {
    const levels = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', raw, '-af', `${foley}volumedetect`, '-f', 'null', '-']).stderr;
    const peak = Number(levels.match(/max_volume:\s*([-\d.]+) dB/)?.[1]);
    if (!Number.isFinite(peak) || peak < -85) throw new Error(`Foley silencioso recusado: ${asset.id}`);
    prepare += `volume=${Math.min(60, -12 - peak)}dB,`;
  }
  prepare += trim;
  const analyse = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', raw, '-af', `${prepare}loudnorm=I=${target}:TP=-2:LRA=11:print_format=json`, '-f', 'null', '-']).stderr;
  const data = JSON.parse(analyse.slice(analyse.lastIndexOf('{'), analyse.lastIndexOf('}') + 1));
  if (!Number.isFinite(Number(data.input_i))) throw new Error(`Áudio silencioso recusado: ${asset.id}`);
  const filter = `${prepare}loudnorm=I=${target}:TP=-2:LRA=11:measured_I=${data.input_i}:measured_TP=${data.input_tp}:measured_LRA=${data.input_lra}:measured_thresh=${data.input_thresh}:offset=${data.target_offset}:linear=true`;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', raw, '-af', filter, '-ar', '48000', '-c:a', 'libvorbis', '-q:a', '6', '-f', 'ogg', output]);
  const info = probe(output);
  const duration = Number(info.format.duration);
  if (!Number.isFinite(duration) || duration < (asset.type === 'music' ? asset.seconds * 0.75 : asset.loop ? asset.seconds * 0.8 : 0.08)) throw new Error(`Duração inválida: ${asset.id}`);
  return { duration, bytes: Number(info.format.size), sampleRate: Number(info.streams[0].sample_rate), channels: info.streams[0].channels, targetLufs: target };
}
export async function main(args = process.argv.slice(2), dependencies = {}) {
  const outputDir = dependencies.outputDir || OUT;
  const request = dependencies.request || fetch;
  const log = dependencies.log || console.log;
  const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const selected = only ? CATALOG.filter(a => only.includes(a.id)) : CATALOG;
  if (only?.some(id => !CATALOG.some(a => a.id === id))) throw new Error('ID desconhecido em --only. Consulte --plan.');
  if (args.includes('--plan')) {
    for (const a of selected) log(`${a.id}: ${a.type}, ${a.seconds}s, ${a.variants} arquivo(s)`);
    log(`Catálogo: ${selected.length} eventos/camadas; ${selected.reduce((n,a) => n + a.variants,0)} arquivos; ${selected.reduce((n,a) => n + a.seconds * a.variants,0).toFixed(1)} segundos de geração.`);
    return;
  }
  const key = dependencies.key ? requireKey(dependencies.key) : await credential();
  const subscription = await (await api('user/subscription', key, undefined, request)).json();
  const tier = subscription.tier;
  log(`Credencial aceita. Plano: ${tier || 'não informado'}. Créditos: ${subscription.character_count ?? '?'} / ${subscription.character_limit ?? '?'}.`);
  if (args.includes('--check-key')) return;
  if (tier === 'free' && selected.some(a => a.type === 'music')) throw new Error('A Music API requer plano pago no ElevenLabs.');
  run('ffmpeg', ['-version']); run('ffprobe', ['-version']);
  await mkdir(path.join(outputDir, 'source'), { recursive: true });
  const manifestFile = path.join(outputDir, 'manifest.json');
  let manifest = { version: 1, provider: 'ElevenLabs', assets: {} };
  if (await exists(manifestFile)) manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const highQuality = !['free', 'starter'].includes(tier);
  for (const asset of selected) {
    const entries = [];
    for (const [index, filename] of filenames(asset).entries()) {
      const output = path.join(outputDir, filename);
      const raw = path.join(outputDir, 'source', filename.replace('.ogg', '.mp3'));
      const rawMeta = raw + '.json';
      const body = bodyFor(asset, index);
      const format = asset.type === 'music' ? 'mp3_48000_192' : highQuality ? 'mp3_44100_192' : 'mp3_44100_128';
      const requestHash = hash(JSON.stringify({ body, format }));
      const renderHash = hash(JSON.stringify({ version: 3, footstep: !!asset.footstep, mono: !!asset.mono, targetLufs: asset.targetLufs ?? null }));
      const previous = manifest.assets[asset.id]?.find(e => e.file === filename && e.requestHash === requestHash && e.renderHash === renderHash);
      if (!args.includes('--force') && previous && await exists(output) && hash(await readFile(output)) === previous.sha256) {
        log(`Existente verificado: ${filename}`); entries.push(previous); continue;
      }
      let provenance;
      if (!args.includes('--force') && await exists(rawMeta) && await exists(raw)) {
        const meta = JSON.parse(await readFile(rawMeta, 'utf8'));
        if (meta.requestHash === requestHash && meta.sha256 === hash(await readFile(raw))) provenance = meta;
      }
      if (!provenance) {
        log(`Gerando no ElevenLabs: ${filename} (${asset.seconds}s)`);
        const endpoint = asset.type === 'music' ? 'music' : 'sound-generation';
        const response = await api(`${endpoint}?output_format=${format}`, key, body, request);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 1000) throw new Error(`Resposta de áudio inválida: ${filename}`);
        await atomic(raw, bytes);
        provenance = { provider: 'ElevenLabs', model: body.model_id, format, requestHash, sha256: hash(bytes), generatedAt: new Date().toISOString(), requestId: response.headers.get('request-id') || response.headers.get('x-request-id'), songId: response.headers.get('song-id') };
        await atomic(rawMeta, JSON.stringify(provenance, null, 2) + '\n');
      } else log(`Retomando master existente: ${filename}`);
      const measurement = normalize(raw, output + '.partial', asset);
      await rename(output + '.partial', output);
      entries.push({ file: filename, ...measurement, ...provenance, renderHash, sha256: hash(await readFile(output)), sourceSha256: provenance.sha256 });
      // Publica somente arquivos concluídos; uma interrupção pode ser retomada.
      manifest.assets[asset.id] = entries;
      manifest.status = 'partial';
      await atomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    }
    manifest.assets[asset.id] = entries;
  }
  manifest.status = CATALOG.every(a => manifest.assets[a.id]?.length === a.variants) ? 'complete' : 'partial';
  await atomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  log(`Geração encerrada: ${manifest.status}. Execute npm run audio:verify.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
