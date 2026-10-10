import type { OpenAPIObject } from '@nestjs/swagger';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule, { type FormatsPlugin } from 'ajv-formats';

/** Validate actual wire JSON against the same document exposed in production. */
export function responseContract(document: OpenAPIObject) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  (addFormatsModule as unknown as FormatsPlugin)(ajv);
  const cache = new Map<string, ValidateFunction>();
  return (
    method: 'get' | 'post' | 'patch',
    url: string,
    response: { status: number; body: unknown },
  ) => {
    const path = Object.keys(document.paths).find((candidate) => {
      const actual = url.split('?')[0].split('/');
      const template = candidate.split('/');
      return (
        actual.length === template.length &&
        template.every(
          (part, index) => /^\{[^}]+\}$/.test(part) || part === actual[index],
        )
      );
    });
    if (!path) throw new Error(`Undocumented route: ${method} ${url}`);
    const key = `${method} ${path} ${response.status}`;
    let validate = cache.get(key);
    if (!validate) {
      const result = document.paths[path][method]?.responses[response.status];
      if (!result || '$ref' in result)
        throw new Error(`Missing response contract: ${key}`);
      const schema = result.content?.['application/json']?.schema;
      if (!schema) throw new Error(`Missing JSON response contract: ${key}`);
      validate = ajv.compile({ ...schema, components: document.components });
      cache.set(key, validate);
    }
    if (!validate(response.body))
      throw new Error(`${key}: ${JSON.stringify(validate.errors)}`);
  };
}
