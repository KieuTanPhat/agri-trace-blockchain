import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceDirectory = '.agents/skills';
export const targetDirectory = '.claude/skills';
export const manifestFile = `${targetDirectory}/.generated-skills.json`;
const skillName = /^agritrace-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = entries => [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

function validateComponent(component) {
  if (!component || component === '.' || component === '..' || /[\\\x00-\x1f<>:"|?*]/.test(component)
    || /[. ]$/.test(component) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) {
    throw new Error(`Unsafe path component: ${JSON.stringify(component)}`);
  }
}

/** Check every existing ancestor, including .agents/.claude, before reading or writing. */
export function safePath(root, relative) {
  const base = path.resolve(root);
  const parts = relative.split('/');
  parts.forEach(validateComponent);
  let current = base;
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info?.isSymbolicLink()) throw new Error(`Symlink/junction is not supported: ${current}`);
    if (info && index < parts.length - 1 && !info.isDirectory()) throw new Error(`Expected directory: ${current}`);
  }
  if (!current.startsWith(`${base}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
  return current;
}

function validSkill(name) {
  if (!skillName.test(name) || name.length > 64) throw new Error(`Invalid project skill name: ${name}`);
}

/** Deliberately small authored format, not a general YAML parser. */
export function parseInstructions(text, filename) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!header) throw new Error(`Missing frontmatter: ${filename}`);
  const fields = {};
  for (const line of header[1].split(/\r?\n/)) {
    const match = /^(name|description): ([^\r\n]+)$/.exec(line);
    if (!match || Object.hasOwn(fields, match[1]) || /^[\s"'!&*{\[|>@`%#]/.test(match[2]) || /:\s|\s#/.test(match[2])) {
      throw new Error(`Use unique name/description with single-line plain scalars: ${filename}`);
    }
    fields[match[1]] = match[2];
  }
  if (!fields.name || !fields.description || fields.description.length > 1024) throw new Error(`Incomplete frontmatter: ${filename}`);
  const body = text.slice(header[0].length);
  if (!body.trim()) throw new Error(`Missing instructions: ${filename}`);
  if (body.includes('$ARGUMENTS') || body.includes('${CLAUDE_SKILL_DIR}') || body.includes('!`')) {
    throw new Error(`Client-specific interpolation is not supported in shared instructions: ${filename}`);
  }
  return { ...fields, body };
}

function walk(root, directory) {
  const result = new Map();
  const caseNames = new Set();
  function visit(relative, prefix = '') {
    const location = safePath(root, relative);
    if (!lstatSync(location).isDirectory()) throw new Error(`Expected directory: ${relative}`);
    for (const entry of readdirSync(location, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      validateComponent(entry.name);
      const key = prefix + entry.name;
      const folded = key.toLowerCase();
      if (caseNames.has(folded)) throw new Error(`Case-insensitive path collision: ${directory}/${key}`);
      caseNames.add(folded);
      const child = `${relative}/${entry.name}`;
      const filename = safePath(root, child);
      if (entry.isDirectory()) visit(child, `${key}/`);
      else if (entry.isFile()) result.set(key, readFileSync(filename));
      else throw new Error(`Only regular files and directories are supported: ${child}`);
    }
  }
  visit(directory);
  return result;
}

export function readSourceSkills(root) {
  const location = safePath(root, sourceDirectory);
  if (!existsSync(location)) throw new Error(`Missing canonical skill directory: ${sourceDirectory}`);
  const files = new Map();
  for (const entry of readdirSync(location, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    validSkill(entry.name);
    const skillPath = `${sourceDirectory}/${entry.name}`;
    safePath(root, skillPath);
    if (!entry.isDirectory()) throw new Error(`Expected skill directory: ${skillPath}`);
    const resources = walk(root, skillPath);
    if (!resources.has('SKILL.md')) throw new Error(`Missing ${skillPath}/SKILL.md`);
    const metadata = parseInstructions(resources.get('SKILL.md').toString('utf8'), `${skillPath}/SKILL.md`);
    if (metadata.name !== entry.name) throw new Error(`Skill name must match directory: ${skillPath}`);
    for (const [resource, bytes] of resources) files.set(`${entry.name}/${resource}`, bytes);
  }
  return new Map(ordered(files));
}

function readManifest(root) {
  const location = safePath(root, manifestFile);
  if (!existsSync(location)) return { bytes: undefined, files: new Map() };
  if (!lstatSync(location).isFile()) throw new Error(`Expected regular file: ${manifestFile}`);
  const bytes = readFileSync(location);
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`Invalid JSON in ${manifestFile}`); }
  if (!document || Object.keys(document).sort().join(',') !== 'files,version' || document.version !== 1
    || !document.files || typeof document.files !== 'object' || Array.isArray(document.files)) {
    throw new Error(`Unsupported manifest shape: ${manifestFile}`);
  }
  const folded = new Set();
  for (const [relative, hash] of Object.entries(document.files)) {
    const parts = relative.split('/');
    if (parts.length < 2) throw new Error(`Invalid manifest file: ${relative}`);
    validSkill(parts[0]);
    safePath(root, `${targetDirectory}/${relative}`);
    if (folded.has(relative.toLowerCase())) throw new Error(`Manifest path collision: ${relative}`);
    folded.add(relative.toLowerCase());
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid manifest checksum: ${relative}`);
  }
  return { bytes, files: new Map(ordered(Object.entries(document.files))) };
}

function atomicWrite(root, relative, bytes) {
  const destination = safePath(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  safePath(root, relative);
  // Root-level temporary files stay outside managed skill trees if the process is interrupted.
  const temporary = safePath(root, `${targetDirectory}/.agritrace-sync-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    safePath(root, relative);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function removeEmptyParents(root, relative) {
  let directory = path.posix.dirname(relative);
  while (directory.startsWith(`${targetDirectory}/`)) {
    try { rmdirSync(safePath(root, directory)); }
    catch (error) {
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) break;
      throw error;
    }
    directory = path.posix.dirname(directory);
  }
}

/** One writer per checkout. The manifest is committed last; identical partial writes are resumable. */
export function syncSkills(root, { check = false } = {}) {
  const expected = readSourceSkills(root);
  const previous = readManifest(root);
  const actual = new Map();
  const names = new Set([...expected.keys(), ...previous.files.keys()].map(file => file.split('/')[0]));
  for (const name of [...names].sort()) {
    const directory = `${targetDirectory}/${name}`;
    if (!existsSync(safePath(root, directory))) continue;
    for (const [resource, bytes] of walk(root, directory)) actual.set(`${name}/${resource}`, bytes);
  }

  // Even a stale/edited manifest must not claim files outside these skill directories.
  for (const [relative, bytes] of actual) {
    const hash = digest(bytes);
    if (hash !== previous.files.get(relative) && (!expected.has(relative) || hash !== digest(expected.get(relative)))) {
      throw new Error(`Conflict: ${targetDirectory}/${relative}; preserve local changes and reconcile manually`);
    }
  }
  const writes = ordered(expected).filter(([relative, bytes]) => !actual.get(relative)?.equals(bytes));
  const removals = [...actual.keys()].filter(relative => !expected.has(relative)).sort();
  const next = Buffer.from(`${JSON.stringify({ version: 1, files: Object.fromEntries(ordered(expected).map(([file, bytes]) => [file, digest(bytes)])) }, null, 2)}\n`);
  const manifestChanged = !previous.bytes?.equals(next);
  if (check) {
    if (writes.length || removals.length || manifestChanged) {
      const details = [...writes.map(([file]) => `missing/stale ${file}`), ...removals.map(file => `obsolete ${file}`)];
      if (manifestChanged) details.push('missing/stale manifest');
      throw new Error(`Generated skills differ; run npm run agents:sync:\n${details.join('\n')}`);
    }
    return { skills: new Set([...expected.keys()].map(file => file.split('/')[0])).size, written: 0, removed: 0 };
  }

  // Recheck all observations after preflight, before the first mutation.
  for (const [relative, bytes] of actual) {
    const filename = safePath(root, `${targetDirectory}/${relative}`);
    if (!existsSync(filename) || !readFileSync(filename).equals(bytes)) throw new Error(`Changed during sync: ${relative}`);
  }
  for (const [relative] of writes) {
    const filename = safePath(root, `${targetDirectory}/${relative}`);
    if (!actual.has(relative) && existsSync(filename)) throw new Error(`Appeared during sync: ${relative}`);
  }
  const currentManifest = safePath(root, manifestFile);
  if (previous.bytes ? !existsSync(currentManifest) || !readFileSync(currentManifest).equals(previous.bytes) : existsSync(currentManifest)) {
    throw new Error('Manifest changed during sync');
  }
  if (writes.length || removals.length || manifestChanged) {
    mkdirSync(safePath(root, targetDirectory), { recursive: true });
    for (const [relative, bytes] of writes) atomicWrite(root, `${targetDirectory}/${relative}`, bytes);
    for (const relative of removals) {
      unlinkSync(safePath(root, `${targetDirectory}/${relative}`));
      removeEmptyParents(root, `${targetDirectory}/${relative}`);
    }
    if (manifestChanged) atomicWrite(root, manifestFile, next);
  }
  return { skills: new Set([...expected.keys()].map(file => file.split('/')[0])).size, written: writes.length, removed: removals.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/sync-agent-skills.mjs [--check]');
    const result = syncSkills(repositoryRoot, { check: args.includes('--check') });
    console.log(`Agent skills ${args.length ? 'match' : 'synchronized'}: ${result.skills} skills, ${result.written} written, ${result.removed} removed.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
