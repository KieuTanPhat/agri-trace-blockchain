import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  manifestFile, parseInstructions, readSourceSkills, repositoryRoot,
  safePath, sourceDirectory, syncSkills, targetDirectory,
} from './sync-agent-skills.mjs';

export const requiredSkills = [
  'agritrace-api-contract', 'agritrace-database-change', 'agritrace-frontend-change',
  'agritrace-hybrid-integrity', 'agritrace-production-release',
];
const reviewer = 'agritrace-reviewer';
const codexConfig = '.codex/config.toml';
const codexReviewer = `.codex/agents/${reviewer}.toml`;
const claudeReviewer = `.claude/agents/${reviewer}.md`;

function textFile(root, relative) {
  const filename = safePath(root, relative);
  if (!lstatSync(filename).isFile()) throw new Error(`Expected regular file: ${relative}`);
  return readFileSync(filename, 'utf8');
}

function checkLinks(root, relative, content) {
  for (const match of content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1];
    if (/^https:\/\//.test(target) || target.startsWith('#')) continue;
    if (/^[a-z]+:/i.test(target) || target.includes('\\')) throw new Error(`Unsupported link in ${relative}: ${target}`);
    const resource = decodeURIComponent(target.split('#')[0]);
    const resolved = path.resolve(root, path.dirname(relative), resource);
    const local = path.relative(root, resolved).split(path.sep).join('/');
    const filename = safePath(root, local);
    if (!lstatSync(filename).isFile()) throw new Error(`Broken file reference in ${relative}: ${target}`);
  }
}

function checkToml(root) {
  // Python's standard parser avoids a second npm dependency and a home-grown TOML parser.
  const script = `import json,sys
if sys.version_info < (3,11): sys.exit(78)
import tomllib
try:
    with open(sys.argv[1], 'rb') as f: config=tomllib.load(f)
    with open(sys.argv[2], 'rb') as f: reviewer=tomllib.load(f)
    print(json.dumps({'config':config,'reviewer':reviewer}))
except (OSError,ValueError) as e:
    print(str(e),file=sys.stderr)
    sys.exit(1)
`;
  const candidates = process.env.AGENT_SETUP_PYTHON
    ? [process.env.AGENT_SETUP_PYTHON] : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const command of candidates) {
    const result = spawnSync(command, ['-c', script, safePath(root, codexConfig), safePath(root, codexReviewer)], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT' || result.status === 78) continue;
    if (result.error || result.status !== 0) throw new Error(`TOML validation failed: ${result.stderr?.trim() || result.error?.message || 'Python execution failed'}`);
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error('Python TOML validator returned invalid output'); }
    if (Object.keys(parsed.config).length) throw new Error('Project Codex config must inherit session settings in v1');
    const role = parsed.reviewer;
    if (Object.keys(role).sort().join(',') !== 'description,developer_instructions,name'
      || role.name !== reviewer || typeof role.description !== 'string' || !role.description.trim()
      || typeof role.developer_instructions !== 'string' || !role.developer_instructions.trim()) {
      throw new Error(`Invalid reviewer fields: ${codexReviewer}`);
    }
    checkLinks(root, codexReviewer, role.developer_instructions);
    return;
  }
  throw new Error('Python 3.11+ is required; optionally set AGENT_SETUP_PYTHON to its executable');
}

function ignored(root, files) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: root, input: `${files.join('\n')}\n`, encoding: 'utf8',
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error(`Cannot verify Git ignore policy: ${result.stderr || result.error?.message}`);
  return new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean));
}

export function checkSetup(root) {
  const result = syncSkills(root, { check: true });
  const source = readSourceSkills(root);
  for (const name of requiredSkills) {
    if (!source.has(`${name}/SKILL.md`)) throw new Error(`Missing required workflow: ${name}`);
  }
  const shared = ['AGENTS.md', 'CLAUDE.md', 'docs/agent-workflow.md'];
  for (const relative of shared) checkLinks(root, relative, textFile(root, relative));
  if (!/^@AGENTS\.md(?:\r?\n|$)/.test(textFile(root, 'CLAUDE.md'))) throw new Error('CLAUDE.md must start with @AGENTS.md');
  for (const [relative, bytes] of source) {
    if (relative.endsWith('.md')) {
      for (const directory of [sourceDirectory, targetDirectory]) checkLinks(root, `${directory}/${relative}`, bytes.toString('utf8'));
    }
  }
  const role = parseInstructions(textFile(root, claudeReviewer), claudeReviewer);
  if (role.name !== reviewer) throw new Error(`Reviewer name mismatch: ${claudeReviewer}`);
  checkLinks(root, claudeReviewer, role.body);
  textFile(root, codexConfig);
  textFile(root, codexReviewer);
  checkToml(root);
  const settingsFile = '.claude/settings.json';
  const settings = JSON.parse(textFile(root, settingsFile));
  if (!settings || Object.keys(settings).join(',') !== '$schema' || settings.$schema !== 'https://json.schemastore.org/claude-code-settings.json') {
    throw new Error('Project Claude settings must contain only the schema in v1');
  }
  const tracked = [codexConfig, codexReviewer, claudeReviewer, settingsFile, manifestFile,
    ...[...source.keys()].flatMap(file => [`${sourceDirectory}/${file}`, `${targetDirectory}/${file}`])];
  const hidden = [...ignored(root, tracked)];
  if (hidden.length) throw new Error(`Shared agent files must not be ignored:\n${hidden.join('\n')}`);
  const local = ['.claude/settings.local.json', '.claude/launch.json', '.claude/worktrees/probe/file',
    '.claude/skills/private-skill/SKILL.md', '.claude/skills/.agritrace-sync-probe.tmp',
    '.codex/evidence/probe.json', '.codex/refactor-baseline/postgres/PG_VERSION', '.codex/run-npm.ps1'];
  const allowed = ignored(root, local);
  if (local.some(file => !allowed.has(file))) throw new Error('Local agent state is not fully protected by Git ignore policy');
  console.log(`Agent setup matches: ${result.skills} skills, both reviewers, references and Git policy.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-agent-setup.mjs');
    checkSetup(repositoryRoot);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
