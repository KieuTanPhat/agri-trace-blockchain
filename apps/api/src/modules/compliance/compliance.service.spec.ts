import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TraceService } from '../trace/trace.service.js';
import { ComplianceService } from './compliance.service.js';

describe('ComplianceService', () => {
  const farmActor = {
    sub: '34695828-dd6f-4463-8607-a9758a2967d6',
    organizationId: '5f664af2-3522-4f18-bebb-38aa135bbcad',
    role: 'FARM_STAFF',
  };
  const auditor = {
    sub: '0ed25731-f220-432a-9d08-443a1c491065',
    organizationId: 'c50de799-747a-4118-a222-8b55fe3d259d',
    role: 'AUDITOR',
  };
  const certificateInput = {
    lotId: 'a6d7dacc-da9a-45b9-b144-5563ae822715',
    type: 'VIETGAP',
    issuer: 'Certification body',
    issueDate: '2026-09-21T00:00:00.000Z',
    documentRef: 's3://certificates/vietgap.pdf',
    documentHash: 'a'.repeat(64),
    isPublic: true,
  };

  it('allows the owning farm to submit a pending certificate', async () => {
    const certificate = {
      id: 'b9038f8a-5a42-49fc-aa62-93225c5b7994',
      ...certificateInput,
      cycleId: null,
      expiryDate: null,
      status: 'PENDING',
    };
    const create = vi.fn().mockResolvedValue(certificate);
    const prisma = {
      lot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ farmOrgId: farmActor.organizationId }),
      },
      $transaction: vi.fn(async (callback) =>
        callback({ certificate: { create } }),
      ),
    };
    const trace = { createInTransaction: vi.fn().mockResolvedValue({}) };
    const service = new ComplianceService(
      prisma as unknown as PrismaService,
      trace as unknown as TraceService,
    );

    await expect(
      service.createCertificate(certificateInput, farmActor),
    ).resolves.toEqual(certificate);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(trace.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CERTIFICATE_SUBMITTED' }),
    );
  });

  it('rejects a farm submitting a certificate for another organization', async () => {
    const prisma = {
      lot: {
        findUnique: vi.fn().mockResolvedValue({
          farmOrgId: '758238df-002a-4a5f-9523-a04949bf01bb',
        }),
      },
    };
    const service = new ComplianceService(
      prisma as unknown as PrismaService,
      {} as TraceService,
    );

    await expect(
      service.createCertificate(certificateInput, farmActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['SYSTEM_ADMIN', 'AUDITOR', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER'])(
    'denies %s unassigned compliance review and inspection without touching persistence',
    async (role) => {
      const transaction = vi.fn();
      const prisma = { $transaction: transaction };
      const trace = { createInTransaction: vi.fn() };
      const service = new ComplianceService(
        prisma as unknown as PrismaService,
        trace as unknown as TraceService,
      );
      const actor = { ...auditor, role };
      await expect(
        service.reviewCertificate('id', { status: 'APPROVED' }, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.createInspection(
          {
            lotId: certificateInput.lotId,
            result: 'PASS',
            inspectedAt: certificateInput.issueDate,
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
      expect(trace.createInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(['SYSTEM_ADMIN', 'AUDITOR', 'TRANSPORTER', 'RETAILER'])(
    'denies %s certificate submission before reading data',
    async (role) => {
      const prisma = { lot: { findUnique: vi.fn() }, $transaction: vi.fn() };
      const service = new ComplianceService(
        prisma as unknown as PrismaService,
        {} as TraceService,
      );
      await expect(
        service.createCertificate(certificateInput, { ...auditor, role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.lot.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
