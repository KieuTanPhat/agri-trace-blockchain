const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pico = require('..');

test('reviewed fork source matches its recorded checksums', () => {
  const provenance = require('../UPSTREAM.json');
  assert.equal(provenance.advisory, 'GHSA-fc5q-39xc-vjpf');
  for (const [name, digest] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(__dirname, '..', name))).digest('hex'), digest, name);
  }
});

test('single-branch repeated wildcards cannot block the event loop', () => {
  // A child timeout keeps this regression safe even if the patch is removed.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const pico = require(${JSON.stringify(path.join(__dirname, '..'))});
    const patterns = ['+(*)', '+(*a)', '*(a*)', '+(a*b)', '+(*?a)', '+(+(*a))',
      'prefix/+(*a).ts', '+(*a|b)', '*(*a)', '+(**a)', '+([[]*a)', '+([*[]*a)'];
    for (const options of [{}, {maxExtglobRecursion:false}, {fastpaths:false}]) {
      for (const pattern of patterns) {
        const match = pico(pattern, options);
        for (const input of ['a'.repeat(2000)+'!', 'a'.repeat(2000)+'b!',
          'prefix/'+'a'.repeat(2000)+'!.ts', '[a'.repeat(1000)+'!']) assert.equal(match(input), false, pattern);
      }
    }
  `], { timeout: 3000, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('normal glob, extglob, escaped and bracket matching stays available', () => {
  for (const [input, glob, options, expected] of [
    ['src/a.ts', '**/*.ts', {}, true], ['src/a.js', '**/*.ts', {}, false],
    ['.hidden', '*', {}, false], ['.hidden', '*', {dot:true}, true],
    ['A.TS', '*.ts', {nocase:true}, true], ['a.tsx', '*.{ts,tsx}', {}, true],
    ['foo', '+(foo|bar)', {}, true], ['foobarfoo', '+(foo|bar)', {}, true],
    ['abcabc', '+(abc)', {}, true], ['foo.js', '!*.ts', {}, true],
    ['a.ts', '[ab].ts', {}, true], ['a*', '+(a\\*)', {}, true],
    ['***', '+([*])', {}, true], ['src/a.test.ts', '**/!(*.spec).ts', {}, true],
    ['a.js', '*.ts', {contains:true}, false],
  ]) assert.equal(pico.isMatch(input, glob, options), expected, JSON.stringify({input,glob,options}));
  assert.equal(pico.makeRe('**/*.ts').test('src/a.ts'), true);
  assert.equal(pico.scan('src/**/*.ts').base, 'src');
  assert.equal(typeof pico.parse('*.ts').output, 'string');
  assert.equal(require('../posix')('**/*.ts')('src/a.ts'), true);
  assert.equal(typeof require('../lib/utils').escapeRegex, 'function');
});
