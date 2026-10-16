import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkSetup, requiredSkills } from './check-agent-setup.mjs';
import { manifestFile, repositoryRoot, syncSkills } from './sync-agent-skills.mjs';

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'agritrace-agent-tests-'));
  const root = path.join(base, 'repo with spaces');
  mkdirSync(root);
  t.after(() => {
    const resolved = path.resolve(base);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('agritrace-agent-tests-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  const put = (relative, bytes) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  const read = relative => readFileSync(path.join(root, relative));
  const skill = (name = 'agritrace-one', body = 'Read the task and report evidence.', eol = '\n') =>
    put(`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: A focused fixture workflow.\n---\n\n${body}\n`.replaceAll('\n', eol));
  skill();
  return { base, root, put, read, skill };
}

function snapshot(root) {
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const info = lstatSync(file);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (info.isSymbolicLink()) files[relative] = { link: readlinkSync(file) };
      else if (info.isDirectory()) visit(file);
      else files[relative] = { hash: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: info.mtimeMs };
    }
  }
  visit(root);
  return files;
}

function setupFixture(t) {
  const f = fixture(t);
  removeFixtureTree(f.root, '.agents/skills/agritrace-one');
  const managed = ['AGENTS.md', 'CLAUDE.md', 'docs/agent-workflow.md', '.gitignore', '.gitattributes', '.dockerignore',
    '.codex/config.toml', '.codex/agents/agritrace-reviewer.toml',
    '.claude/settings.json', '.claude/agents/agritrace-reviewer.md',
    ...requiredSkills.map(name => `.agents/skills/${name}/SKILL.md`)];
  for (const relative of managed) f.put(relative, readFileSync(path.join(repositoryRoot, relative)));
  // Provide the real files linked by the authored instructions, without copying local state.
  for (const relative of managed.filter(file => file.endsWith('.md') || file.endsWith('.toml'))) {
    for (const match of f.read(relative).toString('utf8').matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      if (/^https:\/\//.test(match[1]) || match[1].startsWith('#')) continue;
      const target = path.resolve(f.root, path.dirname(relative), match[1].split('#')[0]);
      const local = path.relative(f.root, target);
      assert.ok(!local.startsWith('..'));
      if (!existsSync(target)) f.put(local, readFileSync(path.join(repositoryRoot, local)));
    }
  }
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  syncSkills(f.root);
  return f;
}

function removeFixtureTree(root, relative) {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`));
  rmSync(target, { recursive: true });
}

test('fresh sync is deterministic; --check and a second sync write nothing', t => {
  const f = fixture(t);
  assert.deepEqual(syncSkills(f.root), { skills: 1, written: 1, removed: 0 });
  assert.deepEqual(f.read('.agents/skills/agritrace-one/SKILL.md'), f.read('.claude/skills/agritrace-one/SKILL.md'));
  const before = snapshot(f.root);
  assert.deepEqual(syncSkills(f.root, { check: true }), { skills: 1, written: 0, removed: 0 });
  assert.deepEqual(syncSkills(f.root), { skills: 1, written: 0, removed: 0 });
  assert.deepEqual(snapshot(f.root), before);
  const manifest = JSON.parse(f.read(manifestFile));
  assert.deepEqual(Object.keys(manifest), ['version', 'files']);
  assert.equal(Object.keys(manifest.files).length, 1);
});

test('resource updates, binary bytes, resource deletion and skill rename follow canonical source', t => {
  const f = fixture(t);
  f.put('.agents/skills/agritrace-one/assets/image.bin', Buffer.from([0, 255, 13, 10, 128]));
  syncSkills(f.root);
  f.skill('agritrace-one', 'Updated instructions.');
  f.put('.agents/skills/agritrace-one/references/new.md', 'New reference.\n');
  unlinkSync(path.join(f.root, '.agents/skills/agritrace-one/assets/image.bin'));
  assert.deepEqual(syncSkills(f.root), { skills: 1, written: 2, removed: 1 });
  assert.ok(!existsSync(path.join(f.root, '.claude/skills/agritrace-one/assets/image.bin')));
  renameSync(path.join(f.root, '.agents/skills/agritrace-one'), path.join(f.root, '.agents/skills/agritrace-renamed'));
  f.skill('agritrace-renamed', 'Renamed workflow.');
  syncSkills(f.root);
  assert.ok(!existsSync(path.join(f.root, '.claude/skills/agritrace-one')));
  assert.equal(f.read('.claude/skills/agritrace-renamed/references/new.md').toString(), 'New reference.\n');
  syncSkills(f.root, { check: true });
});

test('binary resources and CRLF input are copied byte-for-byte and remain checkable', t => {
  const f = fixture(t);
  f.skill('agritrace-one', 'Windows instructions.', '\r\n');
  const binary = Buffer.from([0, 255, 13, 10, 128, 0]);
  f.put('.agents/skills/agritrace-one/assets/data.bin', binary);
  syncSkills(f.root);
  assert.deepEqual(f.read('.claude/skills/agritrace-one/SKILL.md'), f.read('.agents/skills/agritrace-one/SKILL.md'));
  assert.deepEqual(f.read('.claude/skills/agritrace-one/assets/data.bin'), binary);
  syncSkills(f.root, { check: true });
});

test('private skills, local settings, worktrees and evidence survive generated skill deletion', t => {
  const f = fixture(t);
  const local = ['.claude/skills/private-skill/SKILL.md', '.claude/settings.local.json',
    '.claude/worktrees/other/source.ts', '.claude/launch.json', '.codex/evidence/probe.json',
    '.codex/refactor-baseline/postgres/PG_VERSION'];
  for (const file of local) f.put(file, `private ${file}`);
  syncSkills(f.root);
  removeFixtureTree(f.root, '.agents/skills/agritrace-one');
  syncSkills(f.root);
  for (const file of local) assert.equal(f.read(file).toString(), `private ${file}`);
  assert.ok(!existsSync(path.join(f.root, '.claude/skills/agritrace-one')));
});

for (const operation of ['update', 'delete']) {
  test(`edited generated file blocks ${operation} without modifying any file`, t => {
    const f = fixture(t);
    syncSkills(f.root);
    f.put('.claude/skills/agritrace-one/SKILL.md', 'Local edit must survive.');
    if (operation === 'update') f.skill('agritrace-one', 'New source.');
    else removeFixtureTree(f.root, '.agents/skills/agritrace-one');
    const before = snapshot(f.root);
    assert.throws(() => syncSkills(f.root), /Conflict/);
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('unexpected resource blocks even a preceding otherwise-safe update', t => {
  const f = fixture(t);
  f.skill('agritrace-two');
  syncSkills(f.root);
  f.skill('agritrace-one', 'Safe pending update.');
  f.put('.claude/skills/agritrace-two/private.txt', 'Unmanaged data.');
  const before = snapshot(f.root);
  assert.throws(() => syncSkills(f.root), /Conflict.*private\.txt/);
  assert.deepEqual(snapshot(f.root), before);
});

test('missing canonical root cannot erase mirrors, and missing mirrors fail check without writes', t => {
  const f = fixture(t);
  const initial = snapshot(f.root);
  assert.throws(() => syncSkills(f.root, { check: true }), /Generated skills differ/);
  assert.deepEqual(snapshot(f.root), initial);
  syncSkills(f.root);
  renameSync(path.join(f.root, '.agents/skills'), path.join(f.root, '.agents/skills-held'));
  const before = snapshot(f.root);
  assert.throws(() => syncSkills(f.root), /Missing canonical/);
  assert.deepEqual(snapshot(f.root), before);
});

test('interrupted update resumes with old manifest, new bytes, deleted files and orphan temp', t => {
  const f = fixture(t);
  f.put('.agents/skills/agritrace-one/references/old.md', 'Old.');
  syncSkills(f.root);
  f.skill('agritrace-one', 'Updated source after interruption.');
  f.put('.claude/skills/agritrace-one/SKILL.md', f.read('.agents/skills/agritrace-one/SKILL.md'));
  unlinkSync(path.join(f.root, '.agents/skills/agritrace-one/references/old.md'));
  unlinkSync(path.join(f.root, '.claude/skills/agritrace-one/references/old.md'));
  f.put('.agents/skills/agritrace-one/assets/new.bin', Buffer.from([0, 255]));
  f.put('.claude/skills/.agritrace-sync-orphan.tmp', 'Partial temporary write.');
  syncSkills(f.root);
  syncSkills(f.root, { check: true });
  assert.equal(f.read('.claude/skills/.agritrace-sync-orphan.tmp').toString(), 'Partial temporary write.');
});

test('interrupted first sync can adopt only identical canonical files without a manifest', t => {
  const f = fixture(t);
  f.put('.claude/skills/agritrace-one/SKILL.md', f.read('.agents/skills/agritrace-one/SKILL.md'));
  f.put('.agents/skills/agritrace-one/references/new.md', 'Not yet copied.');
  syncSkills(f.root);
  syncSkills(f.root, { check: true });
  assert.equal(f.read('.claude/skills/agritrace-one/references/new.md').toString(), 'Not yet copied.');
});

for (const transition of ['file-to-directory', 'directory-to-file', 'case-only-rename']) {
  for (const interrupted of ['none', 'after-removal', 'after-replacement']) {
    test(`owned ${transition} resumes ${interrupted} with the old manifest`, t => {
      const f = fixture(t);
      const source = '.agents/skills/agritrace-one';
      const target = '.claude/skills/agritrace-one';
      const oldFile = transition === 'file-to-directory' ? 'resource'
        : transition === 'directory-to-file' ? 'resource/nested/old.bin' : 'References/Guide.md';
      const newFile = transition === 'file-to-directory' ? 'resource/nested/new.bin'
        : transition === 'directory-to-file' ? 'resource' : 'references/guide.md';
      const oldRoot = oldFile.split('/')[0];
      f.put(`${source}/${oldFile}`, 'Resource bytes.');
      syncSkills(f.root);
      const oldManifest = f.read(manifestFile);
      removeFixtureTree(f.root, `${source}/${oldRoot}`);
      f.put(`${source}/${newFile}`, 'Resource bytes.');
      if (interrupted !== 'none') {
        // Leave empty old directories to model interruption before directory pruning.
        unlinkSync(path.join(f.root, target, oldFile));
        if (interrupted === 'after-replacement') {
          if (oldFile.includes('/')) removeFixtureTree(f.root, `${target}/${oldRoot}`);
          f.put(`${target}/${newFile}`, 'Resource bytes.');
        }
      }
      assert.deepEqual(f.read(manifestFile), oldManifest);
      const before = snapshot(f.root);
      assert.throws(() => syncSkills(f.root, { check: true }), /Generated skills differ/);
      assert.deepEqual(snapshot(f.root), before);
      syncSkills(f.root);
      syncSkills(f.root, { check: true });
      assert.equal(f.read(`${target}/${newFile}`).toString(), 'Resource bytes.');
      if (transition === 'case-only-rename') {
        assert.ok(readdirSync(path.join(f.root, target)).includes('references'));
        assert.deepEqual(readdirSync(path.join(f.root, target, 'references')), ['guide.md']);
      }
      const completed = snapshot(f.root);
      syncSkills(f.root);
      assert.deepEqual(snapshot(f.root), completed);
    });
  }
}

for (const operation of ['file-replacement', 'parent-case-change']) {
  test(`an unowned empty directory blocks ${operation} before any writes`, t => {
    const f = fixture(t);
    f.put('.agents/skills/agritrace-one/resource/nested/old.md', 'Old bytes.');
    syncSkills(f.root);
    removeFixtureTree(f.root, '.agents/skills/agritrace-one/resource');
    f.put(`.agents/skills/agritrace-one/${operation === 'file-replacement' ? 'resource' : 'Resource/nested/old.md'}`, 'Replacement bytes.');
    f.skill('agritrace-one', 'Another pending update.');
    const localDirectory = path.join(f.root, '.claude/skills/agritrace-one/resource/local-empty');
    mkdirSync(localDirectory);
    const before = snapshot(f.root);
    assert.throws(() => syncSkills(f.root), /Conflict: unowned directory/);
    assert.ok(lstatSync(localDirectory).isDirectory());
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const invalid of [
  '{broken', JSON.stringify({ version: 2, files: {} }),
  JSON.stringify({ version: 1, files: { '../worktrees/file': 'a'.repeat(64) } }),
  JSON.stringify({ version: 1, files: { 'agritrace-one/../../settings.local.json': 'a'.repeat(64) } }),
  JSON.stringify({ version: 1, files: { 'agritrace-one/C:/data': 'a'.repeat(64) } }),
  JSON.stringify({ version: 1, files: { 'agritrace-one/SKILL.md': 'invalid-hash' } }),
]) {
  test(`invalid manifest cannot mutate data (${invalid.slice(0, 65)})`, t => {
    const f = fixture(t);
    syncSkills(f.root);
    f.put(manifestFile, invalid);
    const before = snapshot(f.root);
    assert.throws(() => syncSkills(f.root));
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('bad common frontmatter and client-only grants fail before generating anything', t => {
  const f = fixture(t);
  f.put('.agents/skills/agritrace-one/SKILL.md', '---\nname: agritrace-one\ndescription: Fixture.\nallowed-tools: Bash(*)\n---\nUnsafe extension.');
  const before = snapshot(f.root);
  assert.throws(() => syncSkills(f.root), /frontmatter|plain scalars/);
  assert.deepEqual(snapshot(f.root), before);
});

for (const location of ['.claude', '.claude/skills', '.claude/skills/agritrace-one', '.agents', '.agents/skills/agritrace-one']) {
  test(`directory symlink/junction at ${location} is rejected before writes`, t => {
    const f = fixture(t);
    syncSkills(f.root);
    const link = path.join(f.root, location);
    const moved = path.join(f.base, 'outside-target');
    renameSync(link, moved);
    try {
      symlinkSync(moved, link, process.platform === 'win32' ? 'junction' : 'dir');
      const before = snapshot(f.root);
      const outside = snapshot(moved);
      assert.throws(() => syncSkills(f.root), /Symlink\/junction/);
      assert.deepEqual(snapshot(f.root), before);
      assert.deepEqual(snapshot(moved), outside);
    } finally {
      if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(link);
    }
  });
}

test('case-colliding resources are rejected on case-sensitive filesystems', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  f.put('.agents/skills/agritrace-one/references/Guide.md', 'First');
  f.put('.agents/skills/agritrace-one/references/guide.md', 'Second');
  assert.throws(() => syncSkills(f.root), /collision/);
  assert.ok(!existsSync(path.join(f.root, '.claude')));
});

test('relocated CLI determines root from its script, and rejects unknown flags', t => {
  const f = fixture(t);
  f.put('scripts/sync-agent-skills.mjs', readFileSync(new URL('./sync-agent-skills.mjs', import.meta.url)));
  const cwd = path.join(f.root, 'apps/api');
  mkdirSync(cwd, { recursive: true });
  const script = path.join(f.root, 'scripts/sync-agent-skills.mjs');
  execFileSync(process.execPath, [script], { cwd });
  const before = snapshot(f.root);
  execFileSync(process.execPath, [script, '--check'], { cwd });
  const invalid = spawnSync(process.execPath, [script, '--force'], { cwd, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage/);
  assert.deepEqual(snapshot(f.root), before);
});

test('complete setup check validates actual templates without writing', t => {
  const f = setupFixture(t);
  const before = snapshot(f.root);
  checkSetup(f.root);
  assert.deepEqual(snapshot(f.root), before);
});

test('missing reference fails setup check without writing', t => {
  const f = setupFixture(t);
  unlinkSync(path.join(f.root, 'docs/core-business-rules.md'));
  const before = snapshot(f.root);
  assert.throws(() => checkSetup(f.root));
  assert.deepEqual(snapshot(f.root), before);
});

test('config cannot silently override inherited model or permissions', t => {
  const f = setupFixture(t);
  f.put('.codex/config.toml', 'model = "unexpected-model"\n');
  assert.throws(() => checkSetup(f.root), /inherit session settings/);
  f.put('.codex/config.toml', '# inherit\n');
  f.put('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(*)'] } }));
  assert.throws(() => checkSetup(f.root), /only the schema/);
});

test('Git policy exposes exactly shared files and hides local state; tracked files obey LF attributes', t => {
  const f = setupFixture(t);
  checkSetup(f.root);
  const shared = '.claude/skills/agritrace-api-contract/SKILL.md';
  const local = '.claude/settings.local.json';
  const binary = '.agents/skills/agritrace-api-contract/assets/image.bin';
  f.put(local, '{"private":true}');
  const contents = f.read(shared).toString().replaceAll('\n', '\r\n');
  f.put(shared, contents);
  f.put(binary, Buffer.from([0, 255, 13, 10]));
  execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '--', shared, binary], { cwd: f.root });
  const indexed = execFileSync('git', ['show', `:${shared}`], { cwd: f.root });
  assert.ok(!indexed.includes(Buffer.from('\r\n')));
  assert.deepEqual(execFileSync('git', ['show', `:${binary}`], { cwd: f.root }), Buffer.from([0, 255, 13, 10]));
  const status = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: f.root, encoding: 'utf8' });
  assert.ok(!status.includes('settings.local.json'));
});
