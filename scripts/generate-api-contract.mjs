import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Unknown argument');
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'agri-trace-openapi-'));
try {
  const schema = join(temporary, 'openapi.json');
  execFileSync(process.execPath, [join(root, 'apps/api/dist/openapi-export.js'), schema], {
    cwd: root, stdio: 'inherit', env: { ...process.env, OPENAPI_EXPORT: 'true' },
  });
  const json = await readFile(schema, 'utf8');
  validateContract(JSON.parse(json));
  const types = astToString(await openapiTS(pathToFileURL(schema), { alphabetize: true, arrayLength: true }));
  const artifacts = [
    ['docs/openapi/openapi.json', json],
    ['docs/openapi/openapi.sha256', `${createHash('sha256').update(json.replaceAll('\r\n', '\n')).digest('hex')}  openapi.json\n`],
    ['apps/web/src/lib/generated/api.d.ts', types],
  ];
  for (const [relative, content] of artifacts) {
    const path = join(root, relative);
    if (check) {
      const existing = await readFile(path, 'utf8').catch(() => '');
      if (existing.replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n'))
        throw new Error(`${relative} is stale; run npm run api-contract:generate`);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    }
  }
  process.stdout.write(`API contract ${check ? 'matches' : 'generated'} from compiled NestJS metadata.\n`);
} finally {
  if (dirname(resolve(temporary)) !== temporaryRoot || !basename(temporary).startsWith('agri-trace-openapi-'))
    throw new Error('Unsafe temporary cleanup path');
  await rm(temporary, { recursive: true, force: true });
}

function validateContract(document) {
  const methods = new Set(['get', 'post', 'patch', 'put', 'delete', 'options', 'head']);
  function resolveRef(reference) {
    if (!reference.startsWith('#/')) throw new Error(`External OpenAPI reference is unsupported: ${reference}`);
    const resolved = reference.slice(2).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
      .reduce((value, part) => value?.[part], document);
    if (!resolved) throw new Error(`Unresolved OpenAPI reference: ${reference}`);
    return resolved;
  }
  function properties(schema) {
    if (schema?.$ref) return properties(resolveRef(schema.$ref));
    return Object.assign({}, ...(schema?.allOf ?? []).map(properties), schema?.properties);
  }
  function references(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) resolveRef(value.$ref);
    for (const nested of Object.values(value)) references(nested);
  }
  references(document);
  let operations = 0;
  const operationIds = new Set();
  for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item)) {
    if (!methods.has(method)) continue;
    operations += 1;
    if (typeof operation.operationId !== 'string' || !operation.operationId || operationIds.has(operation.operationId))
      throw new Error(`Missing or duplicate operationId: ${method.toUpperCase()} ${path}`);
    operationIds.add(operation.operationId);
    const success = Object.entries(operation.responses ?? {}).filter(([code]) => /^2\d\d$/.test(code));
    if (!success.length && path !== '/api/auth/register') throw new Error(`${method.toUpperCase()} ${path} has no success contract`);
    for (const [code, response] of success) {
      const fields = properties(response.content?.['application/json']?.schema);
      if (['success', 'data', 'timestamp', 'requestId'].some(field => !fields[field]))
        throw new Error(`${method.toUpperCase()} ${path} ${code} is missing its response envelope/schema`);
    }
    const needsKey = method === 'post' && !path.startsWith('/api/auth/') || method === 'patch' && path === '/api/certificates/{id}/review';
    if (needsKey && !(operation.parameters ?? []).some(parameter => parameter.in === 'header' && parameter.name.toLowerCase() === 'idempotency-key' && parameter.required))
      throw new Error(`${method.toUpperCase()} ${path} must document required Idempotency-Key`);
    if (operation.requestBody && !operation.requestBody.content?.['application/json']?.schema)
      throw new Error(`${method.toUpperCase()} ${path} is missing a JSON request schema`);
  }
  const forbidden = new Set(['actorAuthProof', 'authProofType', 'businessData', 'documentRef', 'reviewNote', 'passwordHash', 'refreshToken', 'authorizationScope', 'deviceId', 'readings', 'submittedByUserId', 'recordedByUserId', 'actorUserId', 'actorOrganizationId']);
  const visited = new Set();
  function publicProjection(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref && !visited.has(value.$ref)) {
      visited.add(value.$ref);
      publicProjection(resolveRef(value.$ref));
    }
    for (const field of Object.keys(value.properties ?? {})) if (forbidden.has(field))
      throw new Error(`PublicLotDto must not expose ${field}`);
    for (const nested of Object.values(value)) publicProjection(nested);
  }
  publicProjection(document.components?.schemas?.PublicLotDto);
  if (!operations || !document.components?.schemas?.PublicLotDto) throw new Error('Incomplete OpenAPI document');
  process.stdout.write(`Validated ${operations} operations and the public projection.\n`);
}
