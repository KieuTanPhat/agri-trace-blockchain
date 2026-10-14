import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const configText = await readFile(new URL('./api-typegen.config.json', import.meta.url), 'utf8');
const config = JSON.parse(configText);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Unknown argument');
const normalize = value => value.replaceAll('\r\n', '\n');
const hash = value => createHash('sha256').update(normalize(value)).digest('hex');
const json = normalize(await readFile(resolve(root, config.input), 'utf8'));
const spec = JSON.parse(json);
const sha = hash(json);
const expectedSha = (await readFile(resolve(root, config.sha256File), 'utf8')).trim().split(/\s+/)[0];
if (sha !== expectedSha) throw new Error('OpenAPI SHA mismatch; obtain the matching AGT-010 artifact and checksum');
if (spec.info.version !== config.version) throw new Error('OpenAPI version differs from api-typegen.config.json');
const require = createRequire(import.meta.url);
const generatorVersion = require('openapi-typescript/package.json').version;
if (generatorVersion !== config.generatorVersion) throw new Error('Unexpected openapi-typescript version; run npm ci');
if (config.unauthenticated.some(id => !Object.values(config.operations).includes(id)))
  throw new Error('Unauthenticated operation is not selected');

function schemaProperties(schema) {
  if (schema?.$ref) {
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) throw new Error(`Unsupported schema reference: ${schema.$ref}`);
    return schemaProperties(spec.components.schemas[schema.$ref.slice(prefix.length)]);
  }
  return Object.assign({}, ...(schema?.allOf ?? []).map(schemaProperties), schema?.properties);
}

// Generate only configured operations. HTTP/session/envelope policy belongs to
// the injected application transport, never to a second fetch implementation.
const methods = [];
for (const [name, id] of Object.entries(config.operations)) {
  if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new Error(`Invalid client method name: ${name}`);
  const matches = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([, op]) => op.operationId === id).map(([method, op]) => ({ path, method, op })));
  if (matches.length !== 1) throw new Error(`Missing or ambiguous operation ${id}`);
  const { path, method, op } = matches[0];
  if (!path.startsWith('/api/')) throw new Error(`Unexpected API prefix: ${path}`);
  const parameters = [...(spec.paths[path].parameters ?? []), ...(op.parameters ?? [])];
  if (parameters.some(p => !['path', 'header'].includes(p.in)))
    throw new Error(`Add query/cookie support before selecting ${id}`);
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
  const pathParameters = [...new Set(parameters.filter(p => p.in === 'path').map(p => p.name))].sort();
  if (JSON.stringify(placeholders) !== JSON.stringify(pathParameters))
    throw new Error(`Path parameters do not match the URL for ${id}`);
  if (config.unauthenticated.includes(id) && (op.security ?? spec.security ?? []).some(s => Object.keys(s).length))
    throw new Error(`Cannot send protected operation anonymously: ${id}`);
  const success = Object.keys(op.responses).filter(code => /^2\d\d$/.test(code));
  if (success.length !== 1) throw new Error(`Expected one success response for ${id}`);
  const fields = schemaProperties(op.responses[success[0]].content?.['application/json']?.schema);
  if (!fields.data || !fields.success) throw new Error(`Missing success envelope for ${id}`);
  if (op.requestBody && (!op.requestBody.required || !op.requestBody.content?.['application/json']?.schema))
    throw new Error(`Expected a required JSON request body for ${id}`);
  const type = `operations[${JSON.stringify(id)}]`;
  const args = [];
  if (pathParameters.length) args.push(`path: ${type}["parameters"]["path"]`);
  if (op.requestBody) args.push(`body: ${type}["requestBody"]["content"]["application/json"]`);
  args.push('init: Omit<RequestInit, "method" | "body"> = {}');
  const url = path.slice(4).replace(/\{([^}]+)\}/g, (_, key) => '${encodeURIComponent(String(path[' + JSON.stringify(key) + ']))}');
  methods.push(`    ${name}(${args.join(', ')}): Promise<${type}["responses"][${success[0]}]["content"]["application/json"]["data"]> {
      return transport(\`${url}\`, { ...init, method: "${method.toUpperCase()}"${op.requestBody ? ', body: JSON.stringify(body)' : ''} }, ${!config.unauthenticated.includes(id)});
    },`);
}
const banner = `// Generated from ${config.input}; version ${config.version}; SHA-256 ${sha}. Do not edit.\n`;
const client = `${banner}import type { operations } from "./api";

export type ContractTransport = <T>(path: string, init?: RequestInit, authenticated?: boolean) => Promise<T>;

export function createContractClient(transport: ContractTransport) {
  return {
${methods.join('\n')}
  };
}
`;
const artifacts = {
  'api.d.ts': banner + astToString(await openapiTS(spec, config.options)),
  'client.ts': client,
  'manifest.json': JSON.stringify({ input: config.input, version: config.version, sha256: sha,
    generator: `openapi-typescript@${generatorVersion}`, configSha256: hash(configText),
    clientGeneratorSha256: hash(await readFile(fileURLToPath(import.meta.url), 'utf8')),
    operations: config.operations }, null, 2) + '\n',
};
for (const [name, content] of Object.entries(artifacts)) {
  const output = resolve(root, config.output, name);
  if (check) {
    const existing = await readFile(output, 'utf8').catch(() => '');
    if (normalize(existing) !== normalize(content)) throw new Error(`${output} has generated drift; run npm run typegen --workspace apps/web`);
  } else {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content);
  }
}
console.log(`Web contract ${check ? 'matches' : 'generated'}: ${config.version} SHA-256 ${sha}; openapi-typescript@${generatorVersion}`);
