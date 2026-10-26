import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CATALOG, filenames } from './catalog.mjs';
import { ROOT, hash, probe } from './generate.mjs';

const folder = path.join(ROOT, 'assets', 'audio');
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
assert.equal(manifest.provider, 'ElevenLabs');
let count = 0, seconds = 0, bytes = 0;
const missing = [];
for (const asset of CATALOG) {
  const entries = manifest.assets[asset.id] || [];
  for (const file of filenames(asset)) {
    const entry = entries.find(e => e.file === file);
    if (!entry) { missing.push(file); continue; }
    assert.equal(entry.provider, 'ElevenLabs');
    assert.ok(['music_v2_5', 'eleven_text_to_sound_v2'].includes(entry.model));
    const data = await readFile(path.join(folder, file));
    assert.equal(hash(data), entry.sha256, `${file}: fingerprint`);
    assert.equal(data.subarray(0,4).toString(), 'OggS', `${file}: container`);
    const info = probe(path.join(folder, file));
    const duration = Number(info.format.duration);
    assert.ok(Math.abs(duration - entry.duration) < 0.05, `${file}: duration`);
    assert.equal(info.streams[0].codec_name, 'vorbis');
    assert.equal(Number(info.streams[0].sample_rate), 48000);
    if (asset.footstep) {
      assert.equal(info.streams[0].channels, 1, `${file}: mono para HRTF`);
      assert.equal(entry.targetLufs, asset.targetLufs, `${file}: ganho de Foley`);
      assert.equal(entries.length, asset.variants, `${file}: variações completas`);
      assert.ok(entry.renderHash, `${file}: processamento atual`);
      assert.equal(new Set(entries.map(e => e.sourceSha256)).size, asset.variants, `${file}: tomadas distintas`);
    }
    const result = spawnSync('ffmpeg', ['-hide_banner','-nostdin','-i',path.join(folder,file),'-af','astats=metadata=0:reset=0','-f','null','-'], { encoding:'utf8', windowsHide:true, maxBuffer:2 * 1024 * 1024 });
    assert.equal(result.status, 0, `${file}: decode`);
    const overall = result.stderr.slice(result.stderr.lastIndexOf('Overall'));
    const rms = Number(overall.match(/RMS level dB:\s*([-\d.]+)/)?.[1]);
    const peak = Number(overall.match(/Peak level dB:\s*([-\d.]+)/)?.[1]);
    assert.ok(Number.isFinite(rms) && rms > -55, `${file}: silence`);
    assert.ok(Number.isFinite(peak) && peak <= -0.5, `${file}: clipping/headroom`);
    count++; seconds += duration; bytes += data.length;
  }
}
if (missing.length) { console.error(`AUDIO_ASSETS_PENDING: ${missing.length} arquivos ainda não gerados; estado: ${manifest.status}.`); process.exitCode = 1; }
else {
  assert.equal(manifest.status, 'complete');
  console.log(`AUDIO_ASSETS_VERIFIED: ${count} arquivos, ${seconds.toFixed(1)}s, ${(bytes/1024/1024).toFixed(1)} MiB, todos decodificados sem silêncio ou clipping.`);
}
