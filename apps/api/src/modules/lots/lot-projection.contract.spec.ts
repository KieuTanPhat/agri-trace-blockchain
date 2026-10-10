import 'reflect-metadata';
import {
  Controller,
  Get,
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiExtraModels, type OpenAPIObject } from '@nestjs/swagger';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import request from 'supertest';
import { vi } from 'vitest';
import {
  ApiDataResponse,
  createOpenApiDocument,
} from '../../common/api/openapi.js';
import { ApiResponseInterceptor } from '../../common/api/api-response.interceptor.js';
import {
  HarvestEventRecordDto,
  ShipmentRecordDto,
  ShipmentTelemetryDigestRecordDto,
} from '../../common/api/record.dto.js';
import { GlobalExceptionFilter } from '../../common/exception/global-exception.filter.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { LotHarvestService } from './lot-harvest.service.js';
import { LotQueryService } from './lot-query.service.js';
import { LotsController, PublicTraceController } from './lots.controller.js';
import { toInternalLotDto, toPublicLotDto } from './lot.presenter.js';
import type { InternalLot, PublicLot } from './lot-query.types.js';

const id = '11111111-1111-4111-8111-111111111111';
const instant = new Date('2026-10-10T01:02:03.000Z');
const rawHarvest = {
  id,
  cycleId: id,
  finalSensorDigestId: null,
  harvestTime: instant,
  quantity: new Prisma.Decimal('12.345'),
  unit: 'kg',
  qualityNote: null,
  grade: null,
  harvestArea: null,
  createdAt: instant,
};

// Exercises Prisma's actual JSON serialization through the production envelope.
@Controller('contract-record')
@ApiExtraModels(ShipmentRecordDto, ShipmentTelemetryDigestRecordDto)
class RecordController {
  @Get()
  @ApiDataResponse(HarvestEventRecordDto)
  get() {
    return rawHarvest;
  }
}

function fixture(expiryDate: Date | null) {
  return {
    id,
    farmOrgId: id,
    lotCode: 'CONTRACT-LOT',
    version: 0,
    product: { productName: 'Vegetables' },
    organization: { id, name: 'Farm', type: 'FARM' },
    initialQuantity: new Prisma.Decimal('12.345'),
    availableQuantity: new Prisma.Decimal('12.345'),
    expiryDate,
    unit: 'kg',
    currentState: 'HARVESTED',
    traceQr: null,
    quantityMovements: [
      {
        id,
        type: 'HARVEST_IN',
        quantity: new Prisma.Decimal('12.345'),
        unit: 'kg',
        beforeQty: new Prisma.Decimal(0),
        delta: new Prisma.Decimal('12.345'),
        afterQty: new Prisma.Decimal('12.345'),
        createdAt: instant,
      },
    ],
    harvest: {
      sensorWindow: null,
      _count: { lateReadings: 0 },
      harvestTime: instant,
      cycle: {
        id,
        cycleCode: 'CYCLE',
        currentState: 'GROWING',
        startDate: null,
        certificates: [],
        traceEvents: [],
        farm: { organizationId: id, name: 'Farm' },
      },
    },
    shipment: null,
    certificates: [],
    traceEvents: [],
  };
}

describe('Lot HTTP payload / generated Nest OpenAPI contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  const query = {
    getPublic: vi.fn(),
    getInternal: vi.fn(),
    getDashboard: vi.fn(),
  };
  const actor = { sub: id, role: 'FARM_STAFF', organizationId: id };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LotsController, PublicTraceController, RecordController],
      providers: [
        { provide: LotQueryService, useValue: query },
        { provide: LotHarvestService, useValue: {} },
        { provide: IdempotencyService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(
      (
        req: { requestId: string; user: typeof actor },
        _res: unknown,
        next: () => void,
      ) => {
        req.requestId = 'contract-request';
        req.user = actor;
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    document = createOpenApiDocument(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  function validator(
    path: string,
    status = '200',
    method: 'get' | 'post' = 'get',
  ) {
    const response = document.paths[path][method]!.responses[status];
    if (!response || '$ref' in response)
      throw new Error('Unexpected response reference');
    // Validate the emitted JSON, including OAS nullable and referenced models.
    const ajv = new Ajv({ strict: false, allErrors: true });
    (addFormatsModule as unknown as FormatsPlugin)(ajv);
    const validate = ajv.compile({
      ...response.content!['application/json'].schema,
      components: document.components,
    });
    return (payload: unknown) => {
      expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
      return validate;
    };
  }

  it.each([null, new Date('2027-01-01T00:00:00.000Z')])(
    'validates public and internal projections including expiry %s',
    async (expiry) => {
      const lot = fixture(expiry);
      query.getPublic.mockResolvedValue(
        toPublicLotDto(lot as unknown as PublicLot, 'token', []),
      );
      query.getInternal.mockResolvedValue(
        toInternalLotDto(lot as unknown as InternalLot, actor),
      );
      for (const [url, path] of [
        ['/api/public/trace/token', '/api/public/trace/{token}'],
        [`/api/lots/${id}`, '/api/lots/{lotId}'],
      ]) {
        const { body } = await request(app.getHttpServer())
          .get(url)
          .expect(200);
        const validate = validator(path)(body);
        expect(body.data.initialQuantity).toBe(12.345);
        expect(body.data.harvestTime).toBe(instant.toISOString());
        expect(body.data.expiryDate).toBe(expiry ? '2027-01-01' : null);
        expect(body.data.productionCycle.startDate).toBeNull();
        expect(
          validate({
            ...body,
            data: { ...body.data, initialQuantity: '12.345' },
          }),
        ).toBe(false);
        if (path.includes('/public/')) {
          expect(body.data.shipment).toBeNull();
          expect(body.data.allowedCommands).toEqual([]);
          expect(body.data).not.toHaveProperty('quantityMovements');
        }
      }
    },
  );

  it('validates raw Prisma Decimal strings and date-time values', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/contract-record')
      .expect(200);
    const validate = validator('/api/contract-record')(body);
    expect(body.data.quantity).toBe('12.345');
    expect(body.data.harvestTime).toBe(instant.toISOString());
    expect(
      validate({ ...body, data: { ...body.data, quantity: 12.345 } }),
    ).toBe(false);
  });

  it('validates a nullable dashboard reference', async () => {
    query.getDashboard.mockResolvedValue({ featuredLot: null, stats: [] });
    const { body } = await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect(200);
    validator('/api/dashboard')(body);
  });

  it.each([
    ['ShipmentRecordDto', 'conditions'],
    ['ShipmentTelemetryDigestRecordDto', 'conditionSummary'],
    ['ShipmentTelemetryDigestRecordDto', 'anomalySummary'],
  ])('accepts all wire JSON values including null in %s.%s', (model, field) => {
    const schema = document.components!.schemas![model];
    if ('$ref' in schema) throw new Error('Expected inline model');
    const validate = new Ajv({ strict: false }).compile(
      schema.properties![field],
    );
    for (const value of [
      null,
      {},
      { temperature: 4 },
      [],
      [null, 1, 'x'],
      'value',
      1.25,
      true,
    ])
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  it('validates filter envelopes for service and request-validation errors', async () => {
    query.getPublic.mockRejectedValueOnce(
      new NotFoundException('Unknown token'),
    );
    const missing = await request(app.getHttpServer())
      .get('/api/public/trace/missing')
      .expect(404);
    validator('/api/public/trace/{token}', '404')(missing.body);
    const invalid = await request(app.getHttpServer())
      .post(`/api/production-cycles/${id}/harvests`)
      .send({ quantity: -1 })
      .expect(400);
    validator(
      '/api/production-cycles/{cycleId}/harvests',
      '400',
      'post',
    )(invalid.body);
    expect(invalid.body.error.message).toBeInstanceOf(Array);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
