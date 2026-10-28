// Packs the 28-product dataset for the production runner: the seed scripts of
// the exact committed release plus the prepared photos (never the operator's
// originals or reference documents). Run locally: node ... --out <empty dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

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
  if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) put(name, execFileSync('git', ['show', `HEAD:${name}`]));
const assets = '.codex/fruit-assets';
const manifest = JSON.parse(readFileSync(`${assets}/manifest.json`, 'utf8'));
put('assets/manifest.json', readFileSync(`${assets}/manifest.json`));
for (const photo of manifest.photos) {
  const bytes = readFileSync(`${assets}/${photo.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), photo.sha256, `${photo.file} differs from its manifest`);
  put(`assets/${photo.file}`, bytes);
}
for (const name of ['land-1.jpg', 'land-2.jpg', 'land-3.jpg', 'inspect.jpg'])
  if (!files[`assets/${name}`]) put(`assets/${name}`, readFileSync(`${assets}/${name}`));
// Same covers publish-fruit-news.mjs renders locally; the API image has no sharp.
for (const photo of ['care', 'warehouse1', 'harvest', 'lot', 'warehouse3', 'water'])
  put(`assets/news-${photo}.jpg`, await sharp(`${assets}/${photo}.jpg`)
    .resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer());
writeFileSync(join(values.out, 'bundle.json'), JSON.stringify({ protocol: 'agritrace-production-dataset-bundle/1', sha, scripts: head, files }, null, 2));
console.log(`Bundle for ${sha}: ${Object.keys(files).length} files`);
