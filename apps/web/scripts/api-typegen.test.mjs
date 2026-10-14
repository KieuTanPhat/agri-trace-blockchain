import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cache = resolve(root, 'node_modules/.cache');

test('artifact generation is reproducible and fails closed without modifying outputs', async t => {
  await mkdir(cache, { recursive: true });
  const fixture = await mkdtemp(resolve(cache, 'agt-typegen-'));
  t.after(async () => {
    assert.equal(dirname(resolve(fixture)), cache);
    assert.ok(basename(fixture).startsWith('agt-typegen-'));
    await rm(fixture, { recursive: true, force: true });
  });
  const files = ['apps/web/scripts/api-typegen.mjs', 'apps/web/scripts/api-typegen.config.json',
    'docs/openapi/openapi.json', 'docs/openapi/openapi.sha256',
    ...['api.d.ts', 'client.ts', 'manifest.json'].map(name => `apps/web/src/shared/api/generated/${name}`)];
  const originals = new Map();
  for (const file of files) originals.set(file, await readFile(resolve(root, file), 'utf8'));
  async function reset() {
    for (const [file, content] of originals) {
      await mkdir(dirname(resolve(fixture, file)), { recursive: true });
      await writeFile(resolve(fixture, file), content);
    }
  }
  function run(...args) {
    return spawnSync(process.execPath, [resolve(fixture, 'apps/web/scripts/api-typegen.mjs'), ...args], { encoding: 'utf8' });
  }
  async function changeSpec(edit, updateChecksum = true) {
    const spec = JSON.parse(originals.get('docs/openapi/openapi.json'));
    edit(spec);
    const json = JSON.stringify(spec, null, 2) + '\n';
    await writeFile(resolve(fixture, 'docs/openapi/openapi.json'), json);
    if (updateChecksum) await writeFile(resolve(fixture, 'docs/openapi/openapi.sha256'), createHash('sha256').update(json).digest('hex') + '  openapi.json\n');
  }
  const cases = [
    ['stale generated client', async () => writeFile(resolve(fixture, 'apps/web/src/shared/api/generated/client.ts'), '// stale\n'), /generated drift/],
    ['missing generated DTO', async () => rm(resolve(fixture, 'apps/web/src/shared/api/generated/api.d.ts')), /generated drift/],
    ['wrong checksum', async () => changeSpec(s => { s.info.description += ' changed'; }, false), /SHA mismatch/],
    ['wrong version', async () => changeSpec(s => { s.info.version = '0.0.0'; }), /version differs/],
    ['missing operation', async () => changeSpec(s => { delete s.paths['/api/lots']; }), /Missing or ambiguous operation/],
    ['inherited query parameter', async () => changeSpec(s => { s.paths['/api/lots'].parameters = [{ in: 'query', name: 'page', schema: { type: 'number' } }]; }), /query\/cookie support/],
    ['path mismatch', async () => changeSpec(s => { s.paths['/api/lots/{lotId}'].get.parameters = []; }), /Path parameters do not match/],
    ['missing envelope', async () => changeSpec(s => { s.paths['/api/lots'].get.responses['200'].content['application/json'].schema = { type: 'array', items: { type: 'string' } }; }), /Missing success envelope/],
    ['public endpoint now protected', async () => changeSpec(s => { s.paths['/api/public/trace/{token}'].get.security = [{ bearer: [] }]; }), /protected operation anonymously/],
  ];
  await t.test('regeneration and CRLF checkout are deterministic', async () => {
    await reset();
    for (const [file, content] of originals) await writeFile(resolve(fixture, file), content.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
    const checked = run('--check');
    assert.equal(checked.status, 0, checked.stderr);
    const generated = run();
    assert.equal(generated.status, 0, generated.stderr);
    for (const name of ['api.d.ts', 'client.ts', 'manifest.json']) {
      const file = `apps/web/src/shared/api/generated/${name}`;
      assert.equal((await readFile(resolve(fixture, file), 'utf8')).replaceAll('\r\n', '\n'), originals.get(file).replaceAll('\r\n', '\n'));
    }
  });
  for (const [name, mutate, pattern] of cases) await t.test(name, async () => {
    await reset();
    await mutate();
    const output = resolve(fixture, 'apps/web/src/shared/api/generated/manifest.json');
    const before = await readFile(output, 'utf8');
    const result = run('--check');
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, pattern);
    assert.equal(await readFile(output, 'utf8'), before);
  });
  await t.test('unknown CLI arguments are rejected', async () => {
    await reset();
    const result = run('--unknown');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown argument/);
  });
});
