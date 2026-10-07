import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, composeArgs } from './config.mjs';

try {
  const {values} = parseArgs({options: {env: {type: 'string', default: '.uat/.env.uat'}, fabric: {type: 'boolean', default: false}, 'config-only': {type: 'boolean', default: false}}});
  const config = loadConfig(values.env);
  if (process.platform !== 'win32') assert.equal(statSync(values.env).mode & 0o077, 0, 'UAT environment file must be private');
  assert.ok(existsSync(config.UAT_ACCOUNTS_FILE), 'Private accounts file is missing');
  if (process.platform !== 'win32') assert.equal(statSync(config.UAT_ACCOUNTS_FILE).mode & 0o077, 0, 'Accounts file must be private');
  const result = spawnSync('docker', [...composeArgs(values.env, values.fabric), '--profile', 'tools', 'config', '--format', 'json'], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  // The config model contains secrets; never print it or Docker stderr.
  assert.equal(result.status, 0, 'Compose configuration could not be resolved');
  const model = JSON.parse(result.stdout);
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal((service.ports ?? []).length, name === 'proxy' ? 1 : 0, `${name} publishes unexpected ports`);
  }
  assert.equal(String(model.services.proxy.ports[0].published), config.HTTP_PORT);
  assert.equal(model.services.proxy.ports[0].host_ip, config.HTTP_BIND);
  assert.equal(model.services.web.build.args.NEXT_PUBLIC_API_BASE_URL, `${config.PUBLIC_ORIGIN}/api`);
  assert.equal(model.services.web.build.args.NEXT_PUBLIC_TRACE_BASE_URL, `${config.PUBLIC_ORIGIN}/trace`);
  assert.equal(model.services.web.build.args.NEXT_PUBLIC_MOCK_API, 'false');
  assert.deepEqual(model.services.api.command, ['node', 'apps/api/dist/main.js']);
  assert.equal(model.services.api.environment.FABRIC_ENABLED, 'false');
  assert.equal((model.services.api.volumes ?? []).length, 0);
  assert.equal((model.services.api.secrets ?? []).length, 0);
  assert.equal(model.services.bootstrap.environment.APP_ENV, 'uat');
  assert.equal(model.services.postgres.volumes[0].target, '/var/lib/postgresql');
  assert.equal(model.services.migrate.restart, 'no');
  if (values.fabric) {
    assert.equal(model.services.worker.environment.FABRIC_ENABLED, 'true');
    assert.equal(model.services.worker.volumes.length, 2);
    for (const mount of model.services.worker.volumes) {
      assert.equal(mount.read_only, true);
      assert.equal(mount.bind.create_host_path, false);
      assert.ok(existsSync(mount.source), 'Signer or TLS trust material is missing');
    }
    const identity = model.services.worker.volumes.find(mount => mount.target === '/fabric-identity');
    const trust = model.services.worker.volumes.find(mount => mount.target === '/fabric-tls/ca.crt');
    assert.ok(identity && trust);
    assert.ok(statSync(identity.source).isDirectory(), 'Relayer MSP must be a directory');
    assert.ok(statSync(trust.source).isFile(), 'TLS trust mount must be a certificate file');
    assert.ok(existsSync(path.join(identity.source, 'signcerts/cert.pem')), 'Relayer signing certificate is missing');
    const keystore = path.join(identity.source, 'keystore');
    const keys = readdirSync(keystore).filter(name => name.endsWith('.pem') || name.endsWith('_sk'));
    assert.equal(keys.length, 1, 'Relayer keystore must contain exactly one signing key');
    for (const name of ['WORKER_UID', 'WORKER_GID']) assert.ok(/^\d+$/.test(config[name] ?? '') && Number(config[name]) > 0, 'Worker must use an explicit non-root signer owner');
    if (process.platform !== 'win32') {
      const key = statSync(path.join(keystore, keys[0]));
      assert.equal(key.mode & 0o077, 0, 'Relayer private key must be private');
      assert.equal(key.uid, Number(config.WORKER_UID), 'Worker UID does not own the signing key');
    }
  } else assert.equal(model.services.worker.environment.FABRIC_ENABLED, 'false');
  if (!values['config-only']) {
    const engine = spawnSync('docker', ['info', '--format', '{{.OSType}}'], {encoding: 'utf8'});
    assert.equal(engine.status, 0, 'Docker daemon is unavailable');
    assert.equal(engine.stdout.trim(), 'linux', 'Linux containers are required');
  }
  console.log(JSON.stringify({result: 'passed',publicOrigin: config.PUBLIC_ORIGIN,fabric: values.fabric,scope: values['config-only'] ? 'configuration only' : 'configuration and Docker engine'}));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'UAT preflight failed');
  process.exitCode = 1;
}
