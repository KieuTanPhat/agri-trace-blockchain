import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const LOCAL_PROJECT = 'agri-trace-demo-local';
export const TARGET_PROTOCOL = 'agritrace-local-fabric/1';

export function remainingResetContainers(intent,receipt,currentIds) {
  assert.equal(intent.generation,receipt.generation);assert.equal(intent.backup,null);
  assert.equal(intent.volume,`${LOCAL_PROJECT}_postgres-data`);
  assert.ok(Array.isArray(intent.containerIds)&&intent.containerIds.length>=4);
  assert.ok(intent.containerIds.every(id=>/^[a-f0-9]{64}$/.test(id)));
  assert.equal(new Set(intent.containerIds).size,intent.containerIds.length);
  assert.ok(currentIds.every(id=>intent.containerIds.includes(id)),'Refuse newly created or unrelated containers during reset recovery');
  return currentIds;
}

/** Validate resource ownership, not just a friendly database name or localhost. */
export function assertOwnedLocalStack(resources, repository) {
  const expected = new Map(['api', 'worker', 'web', 'postgres'].map(service =>
    [`/${LOCAL_PROJECT}-${service}-1`, service]));
  assert.equal(resources.length, expected.size, 'Inspect exactly the four application resources');
  for (const resource of resources) {
    const service = expected.get(resource.Name);
    assert.ok(service, 'Unexpected application container');
    const labels = resource.Config.Labels;
    assert.equal(labels['com.docker.compose.project'], LOCAL_PROJECT, 'Wrong Compose owner');
    assert.equal(labels['com.docker.compose.service'], service, 'Wrong Compose service');
    assert.equal(resolve(labels['com.docker.compose.project.working_dir']), resolve(repository), 'Wrong checkout');
    if (service === 'postgres') {
      assert.ok(resource.Mounts.some(m => m.Type === 'volume' &&
        m.Name === `${LOCAL_PROJECT}_postgres-data` && m.Destination === '/var/lib/postgresql'),
      'Unexpected PostgreSQL storage');
      const env = Object.fromEntries(resource.Config.Env.map(line => {
        const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
      }));
      assert.equal(env.POSTGRES_DB, 'agri_trace', 'Wrong local database');
    }
  }
  return { project: LOCAL_PROJECT, volume: `${LOCAL_PROJECT}_postgres-data`, services: [...expected.values()] };
}

export function assertLocalFabricReceipt(receipt, repository, generation) {
  assert.equal(receipt.protocol, TARGET_PROTOCOL);
  assert.equal(receipt.project, LOCAL_PROJECT);
  assert.equal(resolve(receipt.repository), resolve(repository));
  assert.match(receipt.generation, /^[a-f0-9]{32}$/);
  if (generation) assert.equal(receipt.generation, generation, 'Generation mismatch: reconcile, do not reset');
  assert.equal(receipt.backup, null);
  assert.equal(receipt.production, false);
  assert.match(receipt.instance, /^agritrace-local-[a-f0-9]{12}$/);
  assert.equal(receipt.network, `${receipt.instance}-network`);
  assert.equal(receipt.publicOrigin, 'http://localhost:3000');
  return receipt;
}
