import type { INestApplication, Type } from '@nestjs/common';
import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  DocumentBuilder,
  getSchemaPath,
  SwaggerModule,
} from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth-cookie.js';
import { ApiErrorEnvelopeDto } from './api-error.dto.js';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Agri Trace API')
    .setDescription(
      'Command API for production, lots, shipments and blockchain proofs',
    )
    .setVersion('2.1.0')
    .addBearerAuth()
    .addCookieAuth(
      SESSION_COOKIE_NAME,
      { type: 'apiKey', in: 'cookie' },
      SESSION_COOKIE_NAME,
    )
    .addApiKey(
      { type: 'apiKey', name: 'x-device-key', in: 'header' },
      'deviceKey',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorEnvelopeDto],
    operationIdFactory: (controller, method) => `${controller}_${method}`,
  });
  // OAS 3.0 nullable on an allOf wrapper cannot relax the referenced model's
  // object type. Model null as a separate branch so validators and typegen agree.
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    if ('$ref' in schema) continue;
    for (const property of Object.values(schema.properties ?? {})) {
      if ('$ref' in property || !property.nullable || !property.allOf) continue;
      property.oneOf = [
        { allOf: property.allOf },
        { type: 'object', nullable: true, enum: [null] },
      ];
      delete property.allOf;
      delete property.type;
      delete property.nullable;
    }
  }
  for (const path of Object.values(document.paths))
    for (const method of [
      'get',
      'post',
      'patch',
      'put',
      'delete',
      'options',
      'head',
    ] as const) {
      const operation = path[method];
      if (!operation) continue;
      const parameters = new Map<
        string,
        NonNullable<typeof operation.parameters>[number]
      >();
      for (const parameter of operation.parameters ?? []) {
        if (
          !('$ref' in parameter) &&
          parameter.in === 'header' &&
          parameter.name.toLowerCase() === 'idempotency-key'
        ) {
          parameter.schema = { type: 'string', minLength: 1 };
          parameter.description =
            'Required command key: trimmed, nonblank, at most 255 characters after trimming. ' +
            'Replays the stored result for the same requester/operation/payload after authorization. ' +
            'Missing/invalid key, changed payload or an in-progress command returns 409. ' +
            'This header is not an authentication credential.';
        }
        const key =
          '$ref' in parameter
            ? parameter.$ref
            : `${parameter.in}:${parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name}`;
        if (!parameters.has(key)) parameters.set(key, parameter);
      }
      if (operation.parameters) operation.parameters = [...parameters.values()];
      for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 501, 503]) {
        const current = operation.responses[status];
        if (current && '$ref' in current) continue;
        operation.responses[status] = {
          description:
            current?.description ?? 'Error envelope from GlobalExceptionFilter',
          ...current,
          content: current?.content ?? {
            'application/json': {
              schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
            },
          },
        };
      }
    }
  return document;
}

/** Describes the envelope actually emitted by ApiResponseInterceptor. */
export function ApiDataResponse(
  model: Type<unknown> | 'string',
  status = 200,
  array = false,
) {
  const dataSchema =
    typeof model === 'string'
      ? ({ type: model } as const)
      : { $ref: getSchemaPath(model) };
  return applyDecorators(
    ...(typeof model === 'string' ? [] : [ApiExtraModels(model)]),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['success', 'data', 'timestamp', 'requestId'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: array ? { type: 'array', items: dataSchema } : dataSchema,
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string' },
        },
      },
    }),
  );
}
