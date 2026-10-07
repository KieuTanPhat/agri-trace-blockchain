import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const samplesCommit = '5789681b4f4d24e58fa40f19a69f5496892374b6';
const references = [
  {file: 'compose-test-net.yaml', hash: 'f6f115084a2b010f281cd057c809ced969146bad6ffe6c13411f47a90dfb5569', ports: 7},
  {file: 'compose-ca.yaml', hash: '13c0cd17995d7e8cc205372841eca6aa225694638dfb0becfbf70b9d7a273707', ports: 6},
];

export function restrictCompose(upstream, reference) {
  assert.equal(createHash('sha256').update(upstream).digest('hex'), reference.hash, 'Fabric reference checksum mismatch');
  let ports = 0;
  const restricted = upstream.replace(/^([ \t]+-[ \t]+)(?:"(\d+:\d+)"|(\d+:\d+))[ \t]*$/gm, (_, indent, quoted, unquoted) => {
    ports++;
    return `${indent}"127.0.0.1:${quoted ?? unquoted}"`;
  }).replaceAll('hyperledger/fabric-orderer:latest', 'hyperledger/fabric-orderer:2.5.16')
    .replaceAll('hyperledger/fabric-peer:latest', 'hyperledger/fabric-peer:2.5.16')
    .replaceAll('hyperledger/fabric-ca:latest', 'hyperledger/fabric-ca:1.5.22');
  assert.equal(ports, reference.ports, 'Unexpected Fabric published-port layout');
  return restricted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try {
  const {values} = parseArgs({options: {samples: {type: 'string', default: 'blockchain/.fabric/fabric-samples'}, prepare: {type: 'boolean', default: false}}});
  const samples = path.resolve(values.samples);
  const revision = spawnSync('git', ['-C', samples, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
  assert.equal(revision.status, 0, 'Fabric samples Git checkout is required');
  assert.equal(revision.stdout.trim(), samplesCommit, 'Unsupported Fabric samples revision');
  if (values.prepare) {
    const active = spawnSync('docker', ['ps', '--filter', 'label=service=hyperledger-fabric', '--format', '{{.ID}}'], {encoding: 'utf8'});
    assert.equal(active.status, 0, 'Docker engine is unavailable');
    assert.equal(active.stdout.trim(), '', 'Stop and review the existing Fabric network before changing its host bindings');
    // Validate both files first so unsupported local edits never cause a partial change.
    const changes = references.map(reference => {
      const filename = path.join(samples, 'test-network/compose', reference.file);
      const original = readFileSync(filename, 'utf8');
      const upstream = spawnSync('git', ['-C', samples, 'show', `${samplesCommit}:test-network/compose/${reference.file}`], {encoding: 'utf8'});
      assert.equal(upstream.status, 0, 'Cannot read pinned Fabric Compose reference');
      const restricted = restrictCompose(upstream.stdout, reference);
      assert.ok(original.replaceAll('\r\n', '\n') === upstream.stdout || original.replaceAll('\r\n', '\n') === restricted, 'Fabric Compose has unrelated local changes; refusing overwrite');
      return {filename, original, restricted};
    });
    for (const change of changes) if (change.original !== change.restricted) writeFileSync(change.filename, change.restricted);
  }
  for (const reference of references) {
    const result = spawnSync('docker', ['compose', '-f', path.join(samples, 'test-network/compose', reference.file), 'config', '--format', 'json'], {encoding: 'utf8'});
    assert.equal(result.status, 0, 'Fabric Compose cannot be resolved');
    const model = JSON.parse(result.stdout);
    let ports = 0;
    for (const service of Object.values(model.services)) {
      assert.ok(!service.image.endsWith(':latest'), 'Unpinned Fabric image');
      for (const port of service.ports ?? []) {assert.equal(port.host_ip, '127.0.0.1', 'Fabric host port is not private'); ports++;}
    }
    assert.equal(ports, reference.ports, 'Fabric port count mismatch');
  }
  console.log(JSON.stringify({result: 'passed', samplesCommit, hostBindings: 'IPv4 loopback only', ports: 13, scope: 'Compose configuration; verify running bindings after network startup'}));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Fabric port check failed');
  process.exitCode = 1;
}
