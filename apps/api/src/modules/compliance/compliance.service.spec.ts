import { ConflictException, ForbiddenException } from '@nestjs/common';
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

  it('atomically approves a pending certificate and records an audit event', async () => {
    const pending = {
      id: 'b9038f8a-5a42-49fc-aa62-93225c5b7994',
      lotId: certificateInput.lotId,
      cycleId: null,
      status: 'PENDING',
      documentHash: certificateInput.documentHash,
    };
    const approved = { ...pending, status: 'APPROVED', reviewNote: 'Valid' };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ type: 'AUDITOR' }),
      },
      certificate: { findUnique: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn(async (callback) =>
        callback({
          certificate: {
            updateMany,
            findUniqueOrThrow: vi.fn().mockResolvedValue(approved),
          },
        }),
      ),
    };
    const trace = { createInTransaction: vi.fn().mockResolvedValue({}) };
    const service = new ComplianceService(
      prisma as unknown as PrismaService,
      trace as unknown as TraceService,
    );

    await expect(
      service.reviewCertificate(
        pending.id,
        { status: 'APPROVED', reviewNote: 'Valid' },
        auditor,
      ),
    ).resolves.toEqual(approved);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: pending.id, status: 'PENDING' },
      }),
    );
    expect(trace.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CERTIFICATE_APPROVED' }),
    );
  });

  it('rejects a concurrent second review', async () => {
    const pending = {
      id: 'b9038f8a-5a42-49fc-aa62-93225c5b7994',
      lotId: certificateInput.lotId,
      cycleId: null,
      status: 'PENDING',
      documentHash: certificateInput.documentHash,
    };
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ type: 'AUDITOR' }),
      },
      certificate: { findUnique: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn(async (callback) =>
        callback({
          certificate: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      ),
    };
    const service = new ComplianceService(
      prisma as unknown as PrismaService,
      {} as TraceService,
    );

    await expect(
      service.reviewCertificate(pending.id, { status: 'REJECTED' }, auditor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
