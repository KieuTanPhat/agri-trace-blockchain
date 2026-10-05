"""Pinned, local Graphify workflow for this repository. No model API calls."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import base64
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.tools' / 'graphify'
OUT = ROOT / 'graphify-out'
SCHEMA = ROOT / 'apps/api/prisma/schema.prisma'
SNAPSHOT = ROOT / 'tools/graphify/input/schema-current.sql'
VERSION = '0.9.75'
SEMANTIC = LOCAL / 'semantic.json'
SEMANTIC_STATE = LOCAL / 'semantic-sources.json'
SOURCE_PREFIXES = ('apps/api/src/', 'apps/api/test/', 'apps/web/src/',
                   'blockchain/chaincode/src/', 'blockchain/gateway/src/')
EXACT_FILES = {'README.md', 'apps/web/ARCHITECTURE.md', 'apps/web/public/sw.js',
               'docs/adr-001-modular-monolith-dedicated-worker.md',
               'docs/refactoring-implementation.md', 'docs/graphify-context.md',
               'tools/graphify/input/schema-current.sql'}
VIZ_URL = 'https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js'
VIZ_SHA384 = 'Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1'


def prepare_assets(download: bool = False) -> Path:
    path = LOCAL / 'assets/vis-network.min.js'
    if not path.is_file():
        if not download:
            raise RuntimeError('Pinned local visualization asset missing. Run setup.ps1.')
        with urllib.request.urlopen(VIZ_URL, timeout=30) as response:
            value = response.read(2_000_001)
        if len(value) > 2_000_000:
            raise RuntimeError('Visualization asset exceeds expected size.')
        actual = base64.b64encode(hashlib.sha384(value).digest()).decode('ascii')
        if actual != VIZ_SHA384:
            raise RuntimeError('Visualization asset integrity check failed.')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    actual = base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode('ascii')
    if actual != VIZ_SHA384:
        raise RuntimeError('Local visualization asset integrity check failed.')
    return path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def safe_environment() -> dict[str, str]:
    # Pass OS/runtime variables only. Do not auto-detect backend keys or load .env.
    names = {'PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'TEMP', 'TMP',
             'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT',
             'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS'}
    env = {key: value for key, value in os.environ.items() if key.upper() in names}
    env.update(PYTHONHASHSEED='0', PYTHONUTF8='1', OMP_NUM_THREADS='1',
               OPENBLAS_NUM_THREADS='1', CHECKPOINT_DISABLE='1',
               PRISMA_HIDE_UPDATE_MESSAGE='1', GRAPHIFY_MAX_WORKERS='2')
    return env


def installed_version() -> str:
    value = importlib.metadata.version('graphifyy')
    if value != VERSION:
        raise RuntimeError(f'Expected Graphify {VERSION}; found {value}. Run setup.ps1.')
    return value


def prepare_schema() -> None:
    node = shutil.which('node')
    prisma = ROOT / 'node_modules/prisma/build/index.js'
    if not node or not prisma.is_file():
        raise RuntimeError('The repository Node/Prisma installation is required for the SQL snapshot.')
    result = subprocess.run(
        [node, str(prisma), 'migrate', 'diff', '--from-empty', '--to-schema', str(SCHEMA),
         '--script', '--config', str(ROOT / 'tools/graphify/prisma.config.ts')],
        cwd=ROOT, env=safe_environment(), capture_output=True, text=True,
        encoding='utf-8', check=True, timeout=120,
    )
    sql = result.stdout.replace('\r\n', '\n').strip()
    if 'CREATE TABLE' not in sql:
        raise RuntimeError('Prisma did not produce a usable schema snapshot.')
    content = ('-- Graphify analysis input. Do not execute this file as a migration.\n'
               '-- Source: apps/api/prisma/schema.prisma\n'
               f'-- Source SHA-256: {digest(SCHEMA)}\n'
               '-- Prisma-supported DDL only; custom PostgreSQL rules are documented in docs/graphify-context.md.\n\n'
               + sql + '\n')
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    if not SNAPSHOT.is_file() or SNAPSHOT.read_text(encoding='utf-8') != content:
        SNAPSHOT.write_text(content, encoding='utf-8', newline='\n')


def corpus() -> dict:
    from graphify.detect import detect
    data = detect(ROOT, follow_symlinks=False, google_workspace=False)
    filtered = {}
    omitted = 0
    for kind, paths in data.get('files', {}).items():
        approved = []
        for raw in paths:
            path = Path(raw).resolve()
            if not path.is_relative_to(ROOT):
                raise RuntimeError(f'Corpus path escapes repository: {path}')
            rel = path.relative_to(ROOT).as_posix()
            if re.search(r'(^|/)(node_modules|generated|dist|\.next|coverage|identities|\.tools)(/|$)', rel, re.I):
                raise RuntimeError(f'Excluded directory reached corpus: {rel}')
            if path.name.lower().startswith('.env') or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}:
                raise RuntimeError(f'Sensitive filename reached corpus: {rel}')
            # Upstream ignore negations can match another README with the same
            # basename. Enforce repository-relative paths independently too.
            if (rel in EXACT_FILES or rel.startswith(SOURCE_PREFIXES)
                    or re.fullmatch(r'blockchain/network/[^/]+\.sh', rel)):
                approved.append(raw)
            else:
                omitted += 1
        filtered[kind] = approved
    data['files'] = filtered
    data['total_files'] = sum(map(len, filtered.values()))
    data['project_scope_omitted'] = omitted
    return data


def doc_hashes(data: dict) -> dict[str, str]:
    return {Path(p).relative_to(ROOT).as_posix(): digest(Path(p))
            for p in data.get('files', {}).get('document', [])}


def semantic_evidence(data: dict) -> dict[str, str]:
    paths = {SCHEMA}
    paths.update({ROOT / '.agents/skills/graphify/SKILL.md',
                  ROOT / '.agents/skills/graphify/references/extraction-spec.md'})
    paths.update((ROOT / 'apps/api/prisma/migrations').glob('*/migration.sql'))
    for raw in data.get('files', {}).get('document', []):
        doc = Path(raw)
        for link in re.findall(r'\[[^\]]*\]\(([^\s)#]+)', doc.read_text(encoding='utf-8')):
            if '://' in link:
                continue
            path = (doc.parent / link).resolve()
            if path.is_file() and path.is_relative_to(ROOT):
                paths.add(path)
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted(paths) if p.is_file()}


def source_hashes(data: dict) -> dict[str, str]:
    paths = {Path(p) for values in data.get('files', {}).values() for p in values}
    paths.update({SCHEMA, ROOT / '.graphifyignore', ROOT / '.gitignore',
                  ROOT / 'tools/graphify/project.py', ROOT / 'tools/graphify/prisma.config.ts',
                  ROOT / 'tools/graphify/requirements-windows-py313.lock', ROOT / 'package-lock.json'})
    paths.update((ROOT / 'apps/api/prisma/migrations').glob('*/migration.sql'))
    paths.update(ROOT / rel for rel in semantic_evidence(data))
    # AST module resolution consults these even though they are not content nodes.
    paths.update(ROOT.glob('package.json'))
    for base in ['apps/api', 'apps/web', 'blockchain/chaincode', 'blockchain/gateway']:
        paths.update((ROOT / base).glob('*config*.json'))
        paths.add(ROOT / base / 'package.json')
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted(paths) if p.is_file()}


def semantic_data(data: dict) -> tuple[dict, bool]:
    empty = {'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}
    if not SEMANTIC.is_file() or not SEMANTIC_STATE.is_file():
        return empty, False
    state = json.loads(SEMANTIC_STATE.read_text(encoding='utf-8'))
    if (state.get('sources') != doc_hashes(data)
            or state.get('evidence') != semantic_evidence(data)
            or state.get('fragment_sha256') != digest(SEMANTIC)):
        return empty, False
    value = json.loads(SEMANTIC.read_text(encoding='utf-8'))
    allowed = set(doc_hashes(data))
    if not isinstance(value.get('nodes'), list) or not isinstance(value.get('edges'), list):
        raise RuntimeError('Semantic nodes/edges must be arrays.')
    ids = {node['id'] for node in value['nodes']}
    if len(ids) != len(value['nodes']) or any(not re.fullmatch(r'[a-z0-9_]+', nid) for nid in ids):
        raise RuntimeError('Semantic IDs must be unique normalized strings.')
    for node in value['nodes']:
        if (node.get('file_type') not in {'code', 'document', 'paper', 'image', 'rationale', 'concept'}
                or not isinstance(node.get('label'), str) or not node['label'].strip()):
            raise RuntimeError('Invalid semantic node type/label.')
    found = set()
    hyperedges = value.get('hyperedges', [])
    if not isinstance(hyperedges, list) or len(hyperedges) > 3:
        raise RuntimeError('At most three semantic hyperedges are allowed.')
    for item in value['nodes'] + value['edges'] + hyperedges:
        path = Path(item['source_file'])
        path = path if path.is_absolute() else ROOT / path
        path = path.resolve()
        rel = path.relative_to(ROOT).as_posix()
        if rel not in allowed:
            raise RuntimeError(f'Semantic fragment refers to unapproved source: {rel}')
        found.add(rel)
    if found != allowed:
        raise RuntimeError(f'Semantic fragment is incomplete: {sorted(allowed-found)}')
    for edge in value['edges']:
        if edge['source'] not in ids or edge['target'] not in ids:
            raise RuntimeError('Semantic fragment has a dangling endpoint.')
        confidence, score = edge.get('confidence'), edge.get('confidence_score')
        if (confidence == 'EXTRACTED' and score == 1.0
                or confidence == 'INFERRED' and score in {0.95, 0.85, 0.75, 0.65, 0.55}
                or confidence == 'AMBIGUOUS' and isinstance(score, (int, float)) and 0.1 <= score <= 0.3):
            pass
        else:
            raise RuntimeError('Invalid semantic confidence/score.')
    for edge in hyperedges:
        members = edge.get('nodes', [])
        if len(set(members)) < 3 or not set(members) <= ids:
            raise RuntimeError('Invalid semantic hyperedge members.')
    return value, True


def record_semantic() -> None:
    data = corpus()
    if not SEMANTIC.is_file():
        raise RuntimeError('Write the host-extracted fragment to .tools/graphify/semantic.json first.')
    request = json.loads((LOCAL / 'semantic-request.json').read_text(encoding='utf-8'))
    if request != {'sources': doc_hashes(data), 'evidence': semantic_evidence(data)}:
        raise RuntimeError('Semantic inputs changed during extraction. Re-run sources and extract again.')
    write_json(SEMANTIC_STATE, {'sources': doc_hashes(data), 'evidence': semantic_evidence(data),
                              'fragment_sha256': digest(SEMANTIC), 'producer': 'Codex host extraction',
                              'external_api_calls': 0, 'token_usage': 'not exposed by agent tool'})
    semantic_data(data)
    print(f'Recorded semantic provenance for {len(doc_hashes(data))} documents.')


def reviewed_ast(ast: dict) -> tuple[list[dict], list[dict]]:
    """Remove proven ORM receiver mismatches without modifying upstream cache.

    This repository's tx.<model> and this.prisma.<model> receivers are Prisma
    delegates. Their create/update calls are not application-service methods.
    Upstream sometimes resolves such calls to a same-named service method.
    Keep the raw extraction and every rejected edge for inspection.
    """
    nodes = {n['id']: n for n in ast['nodes']}
    accepted, rejected = [], []
    lines = {}
    for edge in ast['edges']:
        target = nodes.get(edge.get('target'), {})
        file = edge.get('source_file', '')
        location = re.fullmatch(r'L(\d+)', edge.get('source_location') or '')
        label = re.fullmatch(r'\.([A-Za-z_$][\w$]*)\(\)', target.get('label', ''))
        if (edge.get('relation') == 'calls' and location and label
                and file.startswith('apps/api/src/')
                and target.get('source_file', '').startswith('apps/api/src/')
                and '_service_' in target.get('id', '')):
            if file not in lines:
                lines[file] = (ROOT / file).read_text(encoding='utf-8').splitlines()
            line = lines[file][int(location[1])-1]
            pattern = r'\b(?:tx|this\.prisma)\.[A-Za-z_$][\w$]*\.' + re.escape(label[1]) + r'\s*\('
            if re.search(pattern, line):
                rejected.append(dict(edge, rejection_reason='Prisma delegate is not an application-service method',
                                     source_excerpt=line.strip()))
                continue
        accepted.append(edge)
    return accepted, rejected


def document_links(data: dict, ast: dict) -> dict:
    """Connect approved Markdown citations to existing AST file nodes."""
    files = {n['source_file']: n['id'] for n in ast['nodes']
             if n.get('file_type') == 'code' and n.get('label') == Path(n.get('source_file', '')).name}
    docs = doc_hashes(data)
    ids = {rel: re.sub(r'[^a-z0-9_]', '_', str(Path(rel).with_suffix('')).lower())
           for rel in docs}
    nodes = [{'id': ids[rel], 'label': Path(rel).name, 'file_type': 'document',
              'source_file': rel, 'source_location': 'L1', '_origin': 'project_markdown_links'} for rel in docs]
    edges = []
    for rel in docs:
        doc = ROOT / rel
        for num, line in enumerate(doc.read_text(encoding='utf-8').splitlines(), 1):
            for link in re.findall(r'\[[^\]]*\]\(([^\s)#]+)', line):
                if '://' in link:
                    continue
                path = (doc.parent / link).resolve()
                if not path.is_relative_to(ROOT):
                    continue
                linked = path.relative_to(ROOT).as_posix()
                target = files.get(linked) or ids.get(linked)
                if target:
                    edges.append({'source': ids[rel], 'target': target, 'relation': 'references',
                                  'confidence': 'EXTRACTED', 'confidence_score': 1.0,
                                  'source_file': rel, 'source_location': f'L{num}', 'weight': 1.0,
                                  '_origin': 'project_markdown_links'})
    return {'nodes': nodes, 'edges': edges}


def build_graph(code_only: bool = False) -> None:
    from graphify.extract import extract
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all, label_communities_by_hub
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json, to_html
    from graphify.detect import save_manifest
    from graphify.diagnostics import diagnose_extraction

    started = time.perf_counter()
    asset = prepare_assets()
    prepare_schema()
    data = corpus()
    sources = source_hashes(data)
    code = [Path(p) for p in data['files'].get('code', [])]
    if not code:
        raise RuntimeError('No code in approved corpus.')
    print(f'Corpus: {len(code)} code files, {len(doc_hashes(data))} approved documents.', flush=True)
    # Upstream per-file cache currently misses most TS files on this Windows
    # installation. Reuse the complete resolved AST only when every code and
    # resolver input still matches, with an integrity hash for the cached JSON.
    ast_inputs = {rel: sha for rel, sha in sources.items()
                  if not rel.endswith('.md') and not rel.startswith('.agents/')}
    ast_path, ast_state_path = LOCAL / 'ast.json', LOCAL / 'ast-state.json'
    cache = json.loads(ast_state_path.read_text(encoding='utf-8')) if ast_state_path.is_file() else {}
    if (ast_path.is_file() and cache.get('version') == VERSION
            and cache.get('sources') == ast_inputs and cache.get('sha256') == digest(ast_path)):
        ast = json.loads(ast_path.read_text(encoding='utf-8'))
        print('Complete AST cache: all code/resolution inputs unchanged.', flush=True)
    else:
        ast = extract(code, root=ROOT, cache_root=ROOT, parallel=True, max_workers=2)
        write_json(ast_path, ast)
        write_json(ast_state_path, {'version': VERSION, 'sources': ast_inputs, 'sha256': digest(ast_path)})
    ast_edges, rejected = reviewed_ast(ast)
    write_json(LOCAL / 'rejected-ast-edges.json', rejected)
    sem, semantic_fresh = semantic_data(data) if not code_only else ({'nodes': [], 'edges': []}, False)
    citations = document_links(data, ast) if semantic_fresh else {'nodes': [], 'edges': []}
    merged = {'nodes': ast['nodes'] + sem['nodes'] + citations['nodes'],
              'edges': ast_edges + sem['edges'] + citations['edges'],
              'hyperedges': sem.get('hyperedges', []), 'input_tokens': 0, 'output_tokens': 0}
    graph = build_from_json(merged, root=ROOT, directed=True)
    if not graph.number_of_nodes():
        raise RuntimeError('Graph is empty; previous outputs have been preserved.')
    if source_hashes(corpus()) != sources:
        raise RuntimeError('Source changed while building. Retry before publishing graph.')
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    labels = label_communities_by_hub(graph, communities)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)
    candidate = LOCAL / 'candidate'
    candidate.mkdir(parents=True, exist_ok=True)
    # Rebuild candidates from scratch, then publish only after successful export.
    # Intentional deleted-source shrink is safe here because the full corpus was read.
    original_links = [e for e in merged['edges'] if graph.has_edge(e.get('source'), e.get('target'))]
    if not to_json(graph, communities, str(candidate / 'graph.json'), force=True,
                   community_labels=labels, original_links=original_links):
        raise RuntimeError('Graph export refused.')
    report = generate(graph, communities, cohesion, labels, gods, surprises, data,
                      {'input': 0, 'output': 0}, str(ROOT), suggested_questions=questions)
    # The host does not expose token accounting; remove the upstream placeholder
    # cost section so the report never presents the session as zero-cost.
    report = re.sub(r'## (?:Token|Cost)[^\n]*\n.*?(?=\n## |\Z)',
                    '## Host usage\n\nExact token/cost accounting is unavailable.\n',
                    report, flags=re.S)
    report = re.sub(r'^- Token cost:.*$', '- Host semantic token usage: unavailable (not zero)',
                    report, flags=re.M)
    report += ('\n\n## Project evidence and limits\n\n'
               'AST extraction and schema generation are local. Semantic content is extracted by the Codex host; '
               'the host does not expose exact token usage. Required extraction JSON uses zero placeholders; '
               'they are not a total-session cost measurement.\n\n'
               'See docs/graphify-context.md and docs/graphify-usage.md for PostgreSQL, DI, network and historical-document limits.\n')
    report += (f'\nRemoved {len(rejected)} proven Prisma receiver mismatches from AST calls. '
               'Raw extraction and rejected source excerpts are preserved under .tools/graphify/. '
               'JSON retains parallel relationships; HTML and traversal use one edge per directed endpoint pair. '
               'An EXTRACTED tag identifies source extraction, not a guarantee of target resolution or runtime behavior.\n')
    (candidate / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
    if not to_html(graph, communities, str(candidate / 'graph.html'), community_labels=labels):
        raise RuntimeError('HTML export failed; previous outputs have been preserved.')
    html_path = candidate / 'graph.html'
    html = html_path.read_text(encoding='utf-8')
    if VIZ_URL not in html:
        raise RuntimeError('Unexpected visualization template; review the pinned asset integration.')
    html, replacements = re.subn(r'<script\s+src="' + re.escape(VIZ_URL) + r'"[^>]*></script>',
                                '<script src="vendor/vis-network.min.js"></script>', html)
    if replacements != 1:
        raise RuntimeError('Unexpected visualization script tag.')
    # Local files do not use CORS/SRI attributes: Chrome blocks such file://
    # script loads. The wrapper has already verified the bytes via SHA-384.
    html = html.replace(
        '<title>graphify - .tools/graphify/candidate/graph.html</title>', '<title>AgriTrace — Graphify</title>')
    html_path.write_text(html, encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'vendor').mkdir(exist_ok=True)
    shutil.copy2(asset, OUT / 'vendor/vis-network.min.js')
    for name in ['graph.json', 'GRAPH_REPORT.md', 'graph.html']:
        shutil.copy2(candidate / name, OUT / name)
    write_json(OUT / '.project-state.json', {
        'version': VERSION, 'sources': sources, 'semantic_fresh': semantic_fresh,
        'nodes': graph.number_of_nodes(), 'edges': graph.number_of_edges(),
        'code_files': len(code), 'doc_files': len(doc_hashes(data)),
        'duration_seconds': round(time.perf_counter()-started, 3),
        'rejected_orm_calls': len(rejected), 'serialized_relationships': len(original_links),
        'health': diagnose_extraction(merged, directed=True, root=str(ROOT)),
        'graph_sha256': digest(OUT / 'graph.json'),
    })
    write_json(OUT / '.graphify_detect.json', data)
    write_json(OUT / '.graphify_extract.json', merged)
    full_corpus = [p for paths in data['files'].values() for p in paths]
    save_manifest({'code': data['files']['code']}, str(OUT / 'manifest.json'),
                  root=ROOT, kind='ast', scan_corpus=full_corpus,
                  clear_semantic=set(data['files']['document']) if not semantic_fresh else None)
    if semantic_fresh:
        save_manifest({'document': data['files']['document']}, str(OUT / 'manifest.json'),
                      root=ROOT, kind='semantic')
    (OUT / '.graphify_root').write_text(str(ROOT), encoding='utf-8')
    (OUT / '.graphify_python').write_text(sys.executable, encoding='utf-8')
    print(f'Published {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges in {time.perf_counter()-started:.2f}s.')
    if not semantic_fresh:
        print('Document layer pending: use $graphify to refresh approved documents before document answers.')


def status() -> tuple[dict, int]:
    path = OUT / '.project-state.json'
    if not path.is_file():
        return {'state': 'missing', 'action': 'update --code-only, then host semantic extraction'}, 2
    value = json.loads(path.read_text(encoding='utf-8'))
    now = source_hashes(corpus())
    old = value['sources']
    changed = sorted(p for p in set(now) | set(old) if now.get(p) != old.get(p))
    if changed or not (OUT / 'graph.json').is_file() or digest(OUT / 'graph.json') != value['graph_sha256']:
        return {'state': 'stale', 'changed_sources': changed, 'action': 'update'}, 2
    if value['semantic_fresh'] and not semantic_data(corpus())[1]:
        return {'state': 'stale', 'action': 'refresh host semantic extraction, then update'}, 2
    return {key: value[key] for key in ['version', 'nodes', 'edges', 'code_files', 'doc_files', 'duration_seconds', 'semantic_fresh']} | {'state': 'fresh'}, 0


def baseline_check() -> dict:
    base = json.loads((LOCAL / 'baseline/state.json').read_text(encoding='utf-8'))
    failures = []
    for rel, sha in base['files'].items():
        if rel in {'.gitignore', '.dockerignore'}:
            before = (LOCAL / 'baseline' / (rel.lstrip('.') + '.backup')).read_text(encoding='utf-8').splitlines()
            after = (ROOT / rel).read_text(encoding='utf-8').splitlines()
            if after[:len(before)] != before:
                failures.append(rel)
        else:
            path = ROOT / rel
            current = digest(path) if path.is_file() else None
            if current != sha:
                failures.append(rel)
    index_name = subprocess.check_output(['git', 'rev-parse', '--git-path', 'index'], cwd=ROOT, text=True).strip()
    index = Path(index_name)
    index = index if index.is_absolute() else ROOT / index
    if digest(index) != base['index_sha256']:
        failures.append('git index')
    if failures:
        raise RuntimeError(f'Preexisting content changed: {failures}')
    return {'preexisting_files_preserved': len(base['files']), 'git_index_preserved': True}


def main() -> int:
    os.chdir(ROOT)
    installed_version()
    command = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if command == 'version':
        print(f'Graphify {VERSION}; Python {sys.version.split()[0]}; project-local environment')
    elif command == 'schema':
        prepare_schema()
        print('SQL snapshot refreshed without connecting to a database.')
    elif command == 'assets':
        prepare_assets(download=True)
        print('Local visualization asset verified (SHA-384).')
    elif command == 'sources':
        data = corpus()
        write_json(LOCAL / 'semantic-request.json', {'sources': doc_hashes(data), 'evidence': semantic_evidence(data)})
        print(json.dumps({'files': data['files'], 'total_files': data['total_files']}, ensure_ascii=False, indent=2))
    elif command == 'record-semantic':
        record_semantic()
    elif command == 'update':
        build_graph('--code-only' in sys.argv[2:])
    elif command == 'status':
        value, code = status()
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return code
    elif command == 'baseline-check':
        print(json.dumps(baseline_check()))
    elif command in {'query', 'path', 'explain'}:
        value, code = status()
        if code:
            print(json.dumps(value, ensure_ascii=False, indent=2))
            return code
        if not value['semantic_fresh']:
            print('Document layer pending. Results below contain code only.', file=sys.stderr)
        return subprocess.call([sys.executable, '-X', 'utf8', '-m', 'graphify', command, *sys.argv[2:]],
                               cwd=ROOT, env=safe_environment())
    else:
        raise RuntimeError('Supported commands: version, assets, schema, sources, record-semantic, update, status, query, path, explain, baseline-check')
    return 0


if __name__ == '__main__':
    # A subprocess works correctly on Windows; os.execvpe does not replace a Windows process.
    if os.environ.get('PYTHONHASHSEED') != '0' or os.environ.get('GRAPHIFY_PROJECT_ENV') != '1':
        env = safe_environment()
        env['GRAPHIFY_PROJECT_ENV'] = '1'
        raise SystemExit(subprocess.call([sys.executable, '-X', 'utf8', __file__, *sys.argv[1:]], cwd=ROOT, env=env))
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, KeyError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'Graphify project error: {error}', file=sys.stderr)
        raise SystemExit(1)
