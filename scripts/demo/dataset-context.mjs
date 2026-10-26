// Where the dataset publishers read their run/assets and reach API/DB. Local
// targets are found by inspecting the demo Compose stack; production uses the
// one-off container environment checked by seedTarget().
import { execFileSync } from 'node:child_process';
import { assertFruitTarget } from './fresh-fruit-target.mjs';
import { seedTarget } from './seed-target.mjs';

export function datasetContext() {
  if (process.env.AGRITRACE_PRODUCTION_DATASET === 'true') {
    const target = seedTarget();
    return { production: true, base: target.apiBase, run: target.run, assets: target.assets, databaseUrl: target.databaseUrl };
  }
  const [api, postgres] = JSON.parse(execFileSync('docker',
    ['inspect', 'agri-trace-demo-local-api-1', 'agri-trace-demo-local-postgres-1'], { encoding: 'utf8' }));
  const url = new URL(assertFruitTarget(api, postgres, process.cwd()).DATABASE_URL);
  url.hostname = '127.0.0.1';
  url.port = '5433';
  return { production: false, base: 'http://127.0.0.1:8080/api', run: '.codex/fruit-dataset/run',
    assets: '.codex/fruit-assets', databaseUrl: url.href };
}
