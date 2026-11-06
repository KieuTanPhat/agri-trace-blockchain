// Packs the 227-product dataset for the production runner: the seed scripts of
// the exact committed release plus the prepared photos (never the operator's
// originals or reference documents). Run locally: node ... --out <empty dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' }, release: { type: 'string' } } });
assert.ok(values.out, '--out <empty directory> is required');
assert.ok(!existsSync(values.out) || readdirSync(values.out).length === 0, 'Output directory must be empty');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
// Seed scripts may be newer than the installed release only by a commit that
// descends from it and changes nothing outside scripts/demo (no image change).
const sha = values.release ?? head;
assert.match(sha, /^[a-f0-9]{40}$/);
if (sha !== head) {
  execFileSync('git', ['merge-base', '--is-ancestor', sha, head]);
  for (const name of git('diff', '--name-only', sha, head).split('\n').filter(Boolean))
    assert.ok(name.startsWith('scripts/demo/'), `${name} changed after the release; publish a new release instead`);
}
assert.equal(git('status', '--porcelain', '--', 'scripts/demo'), '', 'Seed scripts must match the committed release');
const files = {};
const put = (name, bytes) => {
  mkdirSync(join(values.out, name, '..'), { recursive: true });
  writeFileSync(join(values.out, name), bytes);
  files[name] = createHash('sha256').update(bytes).digest('hex');
};
for (const name of git('ls-files', 'scripts/demo').split('\n'))
  if ((name.endsWith('.mjs') && !name.endsWith('.test.mjs')) || name.startsWith('scripts/demo/dataset/')) put(name, execFileSync('git', ['show', `HEAD:${name}`], { maxBuffer: 1 << 26 }));
const assets = '.codex/seed-227/assets';
const manifest = JSON.parse(readFileSync(`${assets}/manifest.json`, 'utf8'));
put('assets/manifest.json', readFileSync(`${assets}/manifest.json`));
for (const photo of manifest.photos) {
  const bytes = readFileSync(`${assets}/${photo.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), photo.sha256, `${photo.file} differs from its manifest`);
  put(`assets/${photo.file}`, bytes);
}
writeFileSync(join(values.out, 'bundle.json'), JSON.stringify({ protocol: 'agritrace-production-dataset-bundle/1', sha, scripts: head, files }, null, 2));
console.log(`Bundle for ${sha}: ${Object.keys(files).length} files`);
