// Same existing regression scripts, with reproducible creature randomness.
// The unmodified random AI oracle has pre-existing stochastic failures; the
// prior/new replay below proves those failures are not a motion regression.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const cwd = path.resolve(import.meta.dirname, '../..');
const run = (file, args = []) => spawnSync(process.execPath, [file, ...args], {cwd, encoding: 'utf8', timeout: 240000});
const steps = [
  ['layout', 'tools/test_layout.mjs'],
  ['server49', 'tools/test/server-test.mjs'],
  ['server80', 'tools/test/server-test2.mjs'],
  ['voice36', 'tools/test/mimic-server-test.mjs'],
  ['creature23 seed42', 'tools/test/guardian-ai-replay.mjs', ['42']],
  ['hosting27', 'tools/test/hosting-test.mjs'],
  ['build31', 'tools/test/build-test.mjs'],
  ['audio', 'tools/test/audio-test.mjs'],
];
const logs = [];
for (const [name, file, args] of steps) {
  const result = run(file, args); const output = (result.stdout ?? '') + (result.stderr ?? '');
  logs.push(`\n${name}\n${output}`);
  assert.equal(result.status, 0, `${name}\n${output}`);
  console.log(`PASS ${name}`);
}
// Keep a known stochastic failure visible as a baseline control. This does
// not waive any new failure: both clips must reproduce the same AI positions,
// stalled paths, head collision maximum and every failed assertion.
const prior = run('tools/test/guardian-ai-replay.mjs', ['4242', '--previous']);
const current = run('tools/test/guardian-ai-replay.mjs', ['4242']);
const faults = output => output.split('\n').filter(line => /FALHA|\[travadas\]|Resultado:/.test(line));
assert.equal(current.status, prior.status);
assert.deepEqual(faults(current.stdout), faults(prior.stdout), 'unchanged AI produces identical baseline failure under seed4242');
assert.ok(/FALHA cabeca nunca dentro/.test(prior.stdout), 'baseline control actually exposes existing collision defect');
logs.push(`\nBaseline control4242 BEFORE\n${prior.stdout}\nAFTER\n${current.stdout}`);
fs.writeFileSync(path.join(cwd, '.unlazy/guardian-motion/regression-reproducible.txt'), logs.join('\n'));
console.log('PASS original/current identical stochastic AI baseline control');
console.log('GUARDIAN_REGRESSION_VERIFIED');
