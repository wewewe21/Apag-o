// Reproduce the existing randomized AI oracle with identical old/new inputs.
// Only this test process replaces Math.random / the animation read; game files
// and the original regression oracle are never edited.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const seed = Number(process.argv[2] ?? 4242);
let state = seed >>> 0;
Math.random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
if (process.argv.includes('--previous')) {
  const read = fs.readFileSync;
  const old = read(new URL('../../.unlazy/guardian-motion/original-creature.json', import.meta.url));
  fs.readFileSync = (file, options) => String(file).replaceAll('\\', '/').endsWith('/assets/anim/creature.json')
    ? (typeof options === 'string' ? old.toString(options) : old) : read(file, options);
  syncBuiltinESMExports();
}
console.log(`GUARDIAN_AI_REPLAY seed=${seed} data=${process.argv.includes('--previous') ? 'previous' : 'current'}`);
await import('./creature-server-test.mjs');
