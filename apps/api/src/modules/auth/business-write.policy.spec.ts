import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from './organization-access.service.js';
import { ProductionCyclesService } from '../production-cycles/production-cycles.service.js';
import { LotHarvestService } from '../lots/lot-harvest.service.js';
import { ShipmentsService } from '../shipments/shipments.service.js';
import { IotService } from '../iot/iot.service.js';
import type { TraceService } from '../trace/trace.service.js';
import type {
  CreateProductionCycleDto,
  PlantCycleDto,
  CareRecordDto,
  SensorReadingDto,
  VersionedCommandDto,
  CancelCycleDto,
} from '../production-cycles/dto.js';
import type { RecordHarvestDto } from '../lots/dto.js';
import type {
  CreateShipmentDto,
  ShipmentTransitionDto,
  ReceiveShipmentDto,
  RejectShipmentDto,
  DamageShipmentDto,
} from '../shipments/dto.js';
import type {
  IngestSensorReadingDto,
  CreateSensorDigestDto,
  IngestShipmentTelemetryDto,
  BindShipmentDeviceDto,
  CreateTelemetryDigestDto,
} from '../iot/dto.js';

describe('Business service authorization before persistence', () => {
  it.each(['SYSTEM_ADMIN', 'AUDITOR'])(
    'denies all %s business writes even when invoked without HTTP guards',
    async (role) => {
      const transaction = vi.fn();
      const append = vi.fn();
      const accessCalls = vi.fn();
      const prisma = { $transaction: transaction } as unknown as PrismaService;
      const access = {
        assertFarmAccess: accessCalls,
        assertProductionCycleAccess: accessCalls,
        assertLotAccess: accessCalls,
      } as unknown as OrganizationAccessService;
      const trace = { createInTransaction: append } as unknown as TraceService;
      const actor = { sub: 'actor', role, organizationId: 'organization' };
      const cycles = new ProductionCyclesService(prisma, access, trace);
      const harvests = new LotHarvestService(prisma, access, trace);
      const shipments = new ShipmentsService(prisma, access, trace);
      const iot = new IotService(prisma, trace);
      const commands = [
        () => cycles.create({} as CreateProductionCycleDto, actor),
        () => cycles.plant('id', {} as PlantCycleDto, actor),
        () => cycles.addCare('id', {} as CareRecordDto, actor),
        () => cycles.addSensorReading('id', {} as SensorReadingDto, actor),
        () => cycles.close('id', {} as VersionedCommandDto, actor),
        () => cycles.cancel('id', {} as CancelCycleDto, actor),
        () => harvests.recordHarvest('id', {} as RecordHarvestDto, actor),
        () => shipments.create({} as CreateShipmentDto, actor),
        () => shipments.start('id', {} as ShipmentTransitionDto, actor),
        () => shipments.arrive('id', {} as ShipmentTransitionDto, actor),
        () => shipments.receive('id', {} as ReceiveShipmentDto, actor),
        () => shipments.reject('id', {} as RejectShipmentDto, actor),
        () => shipments.damage('id', {} as DamageShipmentDto, actor),
        () => iot.ingest({} as IngestSensorReadingDto, actor),
        () => iot.createSensorDigest('id', {} as CreateSensorDigestDto, actor),
        () =>
          iot.ingestShipmentTelemetry(
            'id',
            {} as IngestShipmentTelemetryDto,
            'key',
            actor,
          ),
        () => iot.bindShipmentDevice('id', {} as BindShipmentDeviceDto, actor),
        () => iot.unbindShipmentDevice('id', 'device', actor),
        () =>
          iot.createTelemetryDigest(
            'id',
            {} as CreateTelemetryDigestDto,
            actor,
          ),
      ];
      for (const command of commands)
        await expect(command()).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled();
      expect(accessCalls).not.toHaveBeenCalled();
    },
  );

  it('requires the custodian role and organization, rather than organization alone', async () => {
    const transaction = vi.fn();
    const findUnique = vi
      .fn()
      .mockResolvedValue({
        id: 'shipment',
        status: 'IN_TRANSIT',
        transporterOrgId: 'carrier',
        retailerOrgId: 'retailer',
      });
    const prisma = {
      shipment: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService;
    const shipments = new ShipmentsService(
      prisma,
      {} as OrganizationAccessService,
      {} as TraceService,
    );
    await expect(
      shipments.start('shipment', {} as ShipmentTransitionDto, {
        sub: 'actor',
        role: 'TRANSPORTER',
        organizationId: 'other',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shipments.damage('shipment', {} as DamageShipmentDto, {
        sub: 'actor',
        role: 'RETAILER',
        organizationId: 'carrier',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
