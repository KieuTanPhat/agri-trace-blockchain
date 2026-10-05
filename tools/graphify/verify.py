"""Acceptance checks for the local integration; does not run application tests."""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

import project as p


def fixture_checks() -> dict:
    from graphify.extract import extract
    from graphify.build import build_from_json
    original = {key: getattr(p, key) for key in ['ROOT', 'LOCAL', 'OUT', 'SCHEMA', 'SNAPSHOT', 'SEMANTIC', 'SEMANTIC_STATE']}
    checks = {}
    previous_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(prefix='Graphify Việt space ', dir=p.LOCAL) as raw:
        root = Path(raw).resolve()
        assert root.is_relative_to(p.LOCAL.resolve())
        for name in ['.gitignore', '.graphifyignore']:
            shutil.copy2(p.ROOT / name, root / name)

        def put(rel: str, text: str) -> Path:
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
            return path

        files = {
            'apps/api/src/example.ts': 'export function alpha() { return 1; }\nexport function beta() { return alpha(); }\n',
            'apps/web/src/example.tsx': 'export function Frontend() { return <div>test</div>; }\n',
            'blockchain/chaincode/src/example.ts': 'export class Contract { submit() { return true; } }\n',
            'blockchain/gateway/src/example.ts': 'export function Gateway() { return 1; }\n',
            'tools/graphify/input/schema-current.sql': 'CREATE TABLE lot (id UUID PRIMARY KEY);\n',
            'apps/api/src/demo.service.ts': 'export class ExampleService {\n create() { return 1; }\n receive(tx:any) { tx.quantityMovement.create({}); }\n good() { return this.create(); }\n}\n',
            'README.md': '# Fixture\nApproved architecture document.\n',
        }
        for rel, text in files.items():
            put(rel, text)
        blocked = ['apps/api/src/.env.secret.ts', 'apps/api/src/generated/prisma/client.ts',
                   'apps/api/src/node_modules/example/private.ts', 'apps/api/src/wallet/private.ts',
                   'apps/api/src/identities/private.ts', 'apps/api/src/server.key',
                   'apps/web/src/.next/build.ts', 'docs/business-specification-v1.2.md',
                   'docs/design/README.md', 'apps/api/README.md', 'outside/private.ts']
        sentinel = 'GRAPHIFY_FIXTURE_SECRET_MUST_NOT_ENTER_GRAPH'
        for rel in blocked:
            put(rel, 'export const ' + sentinel + ' = 1;\n')
        put('apps/api/prisma/schema.prisma', 'datasource db { provider = "postgresql" }\n')
        p.ROOT, p.LOCAL, p.OUT = root, root / '.tools/graphify', root / 'graphify-out'
        p.SCHEMA, p.SNAPSHOT = root / 'apps/api/prisma/schema.prisma', root / 'tools/graphify/input/schema-current.sql'
        p.SEMANTIC, p.SEMANTIC_STATE = p.LOCAL / 'semantic.json', p.LOCAL / 'semantic-sources.json'
        try:
            data = p.corpus()
            selected = {Path(f).relative_to(root).as_posix() for paths in data['files'].values() for f in paths}
            assert selected == set(files), selected ^ set(files)
            checks['exact_allowlist_and_sensitive_exclusions'] = True
            ast = extract([Path(f) for f in data['files']['code']], root=root, cache_root=root, parallel=False)
            assert sentinel not in json.dumps(ast)
            assert all(any(n.get('source_file', '').startswith(scope) for n in ast['nodes'])
                       for scope in ['apps/api/', 'apps/web/', 'blockchain/chaincode/', 'blockchain/gateway/'])
            checks['windows_unicode_spaces_and_four_workspaces'] = True
            accepted, rejected = p.reviewed_ast(ast)
            assert any('tx.quantityMovement.create' in e['source_excerpt'] for e in rejected)
            assert any(e['source'].endswith('_good') and e['target'].endswith('_create')
                       and e['relation'] == 'calls' for e in accepted), accepted
            checks['orm_receiver_false_target_removed_real_self_call_kept'] = True

            put('apps/api/src/example.ts', 'export function gamma() { return 2; }\nexport function beta() { return gamma(); }\n')
            changed = extract([Path(f) for f in data['files']['code']], root=root, cache_root=root, parallel=False)
            assert any(n['id'].endswith('_gamma') for n in changed['nodes'])
            assert not any(n['id'].endswith('_alpha') for n in changed['nodes'])
            (root / 'blockchain/gateway/src/example.ts').unlink()
            after = p.corpus()
            deleted = extract([Path(f) for f in after['files']['code']], root=root, cache_root=root, parallel=False)
            graph = build_from_json(deleted, root=root, directed=True)
            assert not any('blockchain_gateway_src_example' in node for node in graph)
            checks['cached_changed_and_deleted_files'] = True

            p.write_json(p.OUT / 'graph.json', {'fixture': True})
            state = {'version': p.VERSION, 'sources': p.source_hashes(after), 'semantic_fresh': False,
                     'nodes': graph.number_of_nodes(), 'edges': graph.number_of_edges(),
                     'code_files': len(after['files']['code']), 'doc_files': 1, 'duration_seconds': 0,
                     'graph_sha256': p.digest(p.OUT / 'graph.json')}
            p.write_json(p.OUT / '.project-state.json', state)
            assert p.status()[1] == 0
            put('apps/api/src/example.ts', 'export function changedAgain() { return 3; }\n')
            assert p.status()[1] == 2
            argv = sys.argv
            try:
                sys.argv = ['project.py', 'query', 'alpha']
                with redirect_stdout(io.StringIO()):
                    assert p.main() == 2
            finally:
                sys.argv = argv
            checks['stale_source_blocks_query_before_traversal'] = True
            put('apps/api/src/example.ts', 'export function gamma() { return 2; }\nexport function beta() { return gamma(); }\n')
            assert p.status()[1] == 0
            p.write_json(p.OUT / 'graph.json', {'tampered': True})
            assert p.status()[1] == 2
            checks['tampered_graph_blocks_query'] = True

            doc = str(root / 'README.md')
            fragment = {'nodes': [{'id': 'readme_fixture', 'label': 'Fixture', 'file_type': 'concept',
                                    'source_file': doc}], 'edges': [], 'hyperedges': []}
            p.write_json(p.SEMANTIC, fragment)
            p.write_json(p.LOCAL / 'semantic-request.json', {'sources': p.doc_hashes(after), 'evidence': p.semantic_evidence(after)})
            with redirect_stdout(io.StringIO()):
                p.record_semantic()
            assert p.semantic_data(after)[1]
            fragment['edges'] = [{'source': 'readme_fixture', 'target': 'missing', 'source_file': doc,
                                  'relation': 'references', 'confidence': 'EXTRACTED', 'confidence_score': 1.0}]
            p.write_json(p.SEMANTIC, fragment)
            assert not p.semantic_data(after)[1]
            try:
                with redirect_stdout(io.StringIO()):
                    p.record_semantic()
            except RuntimeError:
                pass
            else:
                raise AssertionError('Dangling semantic endpoint accepted')
            checks['semantic_provenance_and_invalid_endpoint_rejection'] = True
        finally:
            os.chdir(previous_cwd)
            for key, value in original.items():
                setattr(p, key, value)
    return checks


def actual_graph_checks() -> dict:
    state, code = p.status()
    assert code == 0 and state['semantic_fresh'], state
    data = json.loads((p.OUT / 'graph.json').read_text(encoding='utf-8'))
    assert data['directed'] is True
    nodes = {node['id']: node for node in data['nodes']}
    links = data['links']
    assert all(edge['source'] in nodes and edge['target'] in nodes for edge in links)
    assert all(edge.get('confidence_score') is not None for edge in links)
    source_set = {Path(f).relative_to(p.ROOT).as_posix() for values in p.corpus()['files'].values() for f in values}
    for node in nodes.values():
        raw = node.get('source_file')
        if raw:
            path = Path(raw)
            path = path if path.is_absolute() else p.ROOT / path
            assert path.resolve().relative_to(p.ROOT).as_posix() in source_set, raw

    calls = {(e['source'], e['target']) for e in links if e['relation'] == 'calls'}
    pairs = {
        'auth_login_refresh': [
            ('apps_api_src_modules_auth_auth_controller_authcontroller_login', 'apps_api_src_modules_auth_auth_service_authservice_login'),
            ('apps_api_src_modules_auth_auth_controller_authcontroller_refresh', 'apps_api_src_modules_auth_auth_service_authservice_refresh')],
        'harvest_lot_trace_outbox': [
            ('apps_api_src_modules_lots_lots_service_lotsservice_recordharvest', 'apps_api_src_modules_lots_record_harvest_service_recordharvestservice_recordharvest'),
            ('apps_api_src_modules_lots_record_harvest_service_recordharvestservice_recordharvest', 'apps_api_src_modules_trace_trace_service_traceservice_createintransaction')],
        'worker_delivery': [
            ('apps_api_src_modules_blockchain_adapter_blockchain_worker_service_blockchainworkerservice_processpending', 'apps_api_src_modules_blockchain_adapter_blockchain_worker_service_blockchainworkerservice_submit')],
        'shipment_receive': [
            ('apps_api_src_modules_shipments_shipments_controller_shipmentscontroller_receive', 'apps_api_src_modules_shipments_shipments_service_shipmentsservice_receive'),
            ('apps_api_src_modules_shipments_shipments_service_shipmentsservice_receive', 'apps_api_src_modules_trace_trace_service_traceservice_createintransaction')],
        'qr_public_projection': [
            ('apps_api_src_modules_lots_lot_query_service_lotqueryservice_getpublic', 'apps_api_src_modules_lots_lot_presenter_presentpubliclot')],
    }
    for name, required in pairs.items():
        assert all(pair in calls for pair in required), (name, required)
        for source, target in required:
            for node_id in [source, target]:
                node = nodes[node_id]
                path = p.ROOT / node['source_file']
                num = int(node['source_location'].removeprefix('L'))
                assert 0 < num <= len(path.read_text(encoding='utf-8').splitlines())
    assert 'blockchain_chaincode_src_traceability_contract_agritracecontract_recordtraceevent' in nodes
    assert 'blockchain_gateway_src_adapter_fabricblockchainadapter_submittraceevent' in nodes
    assert 'apps_api_src_modules_lots_lot_proof_status_aggregateproofstatus' in nodes
    assert 'apps_web_src_shared_api_http_client' in nodes
    assert any(n.get('_origin') == 'project_markdown_links' for n in nodes.values())
    assert any(e.get('_origin') == 'project_markdown_links' for e in links)

    queries = ['AuthService refresh token', 'RecordHarvestService TraceService outbox',
               'BlockchainWorkerService FabricBlockchainAdapter RecordTraceEvent',
               'ShipmentsService receive quantity', 'LotQueryService presentPublicLot proofStatus']
    cli = []
    for query in queries:
        result = subprocess.run([sys.executable, '-X', 'utf8', str(p.ROOT / 'tools/graphify/project.py'),
                                 'query', query, '--budget', '1000'], cwd=p.ROOT,
                                env=p.safe_environment(), capture_output=True, text=True,
                                encoding='utf-8', timeout=60)
        assert result.returncode == 0 and 'NODE ' in result.stdout, (query, result.stderr)
        cli.append({'query': query, 'exit_code': result.returncode, 'output_chars': len(result.stdout)})
    for command, args in [
        ('explain', ['apps_api_src_modules_lots_record_harvest_service_recordharvestservice_recordharvest']),
        ('path', ['apps_api_src_modules_lots_record_harvest_service_recordharvestservice_recordharvest',
                  'apps_api_src_modules_trace_trace_service_traceservice_createintransaction'])]:
        result = subprocess.run([sys.executable, '-X', 'utf8', str(p.ROOT / 'tools/graphify/project.py'), command, *args],
                                cwd=p.ROOT, env=p.safe_environment(), capture_output=True,
                                text=True, encoding='utf-8', timeout=60)
        assert result.returncode == 0 and result.stdout.strip(), (command, result.stderr)
        cli.append({'command': command, 'exit_code': result.returncode})
    html = (p.OUT / 'graph.html').read_text(encoding='utf-8')
    assert p.VIZ_URL not in html and 'vendor/vis-network.min.js' in html
    assert p.prepare_assets().read_bytes() == (p.OUT / 'vendor/vis-network.min.js').read_bytes()
    return {'five_flow_source_and_call_pairs': list(pairs), 'cli': cli,
            'directed_and_endpoint_integrity': True, 'source_scope_verified': True,
            'document_to_source_citations': True, 'local_html_asset_integrity': True,
            'graph': state}


def main() -> None:
    started = time.perf_counter()
    p.installed_version()
    p.LOCAL.mkdir(parents=True, exist_ok=True)
    # Graphify's stat cache recommends one process per scan root. Isolate the
    # synthetic repository so it cannot affect the actual project's cache.
    worker = subprocess.run([sys.executable, '-X', 'utf8', __file__, '--fixture-worker'],
                            cwd=p.ROOT, env=p.safe_environment(), capture_output=True,
                            text=True, encoding='utf-8', timeout=60, check=True)
    fixture = json.loads(worker.stdout)
    result = {'fixture': fixture, 'actual_graph': actual_graph_checks(),
              'baseline': p.baseline_check(), 'application_tests_run': False,
              'live_database_or_fabric_checked': False,
              'elapsed_seconds': round(time.perf_counter()-started, 3)}
    p.write_json(p.LOCAL / 'acceptance.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if '--fixture-worker' in sys.argv:
        print(json.dumps(fixture_checks()))
    else:
        main()
