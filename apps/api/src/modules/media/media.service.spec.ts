import { ForbiddenException } from '@nestjs/common';
import { MediaKind, MediaVisibility } from '../../generated/prisma/client.js';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { MediaService } from './media.service.js';

describe('MediaService permissions', () => {
  const farmOrgId = '11111111-1111-4111-8111-111111111111';
  const transporterOrgId = '22222222-2222-4222-8222-222222222222';
  const lotId = '33333333-3333-4333-8333-333333333333';
  const userId = '44444444-4444-4444-8444-444444444444';
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

  const asset = {
    id: '55555555-5555-4555-8555-555555555555',
    productId: null,
    lotId,
    kind: MediaKind.EVIDENCE_DOCUMENT,
    visibility: MediaVisibility.PRIVATE,
    originalName: 'proof.png',
    mimeType: 'image/png',
    sizeBytes: png.length,
    sha256: 'a'.repeat(64),
    createdAt: new Date(),
  };
  const findUnique = vi.fn();
  const create = vi.fn();
  const assertLotAccess = vi.fn();
  const prisma = {
    mediaAsset: { findUnique, create },
  } as unknown as PrismaService;
  const access = { assertLotAccess } as unknown as OrganizationAccessService;
  const service = new MediaService(prisma, access);

  beforeEach(() => {
    vi.resetAllMocks();
    assertLotAccess.mockResolvedValue({ id: lotId, farmOrgId });
    findUnique.mockResolvedValue(asset);
  });

  it('hides private evidence from anonymous users', async () => {
    await expect(service.getMetadata(asset.id, null)).rejects.toHaveProperty('status', 404);
    expect(assertLotAccess).not.toHaveBeenCalled();
  });

  it('allows a shipment participant to view private evidence after lot access check', async () => {
    const actor = { sub: userId, role: 'TRANSPORTER', organizationId: transporterOrgId };
    const result = await service.getMetadata(asset.id, actor);
    expect(result.contentUrl).toBe(`/api/media/${asset.id}/content`);
    expect(assertLotAccess).toHaveBeenCalledWith(actor, lotId);
  });

  it('does not allow a transporter to publish evidence or upload a lot image', async () => {
    const actor = { sub: userId, role: 'TRANSPORTER', organizationId: transporterOrgId };
    const file = { buffer: png, size: png.length, mimetype: 'image/png', originalname: 'proof.png' };
    await expect(service.upload({ kind: MediaKind.EVIDENCE_DOCUMENT, lotId, visibility: MediaVisibility.PUBLIC }, file, actor))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.upload({ kind: MediaKind.LOT_IMAGE, lotId }, file, actor))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a lot image uploaded for another organization', async () => {
    const actor = { sub: userId, role: 'FARM_STAFF', organizationId: transporterOrgId };
    const file = { buffer: png, size: png.length, mimetype: 'image/png', originalname: 'lot.png' };
    await expect(service.upload({ kind: MediaKind.LOT_IMAGE, lotId }, file, actor))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
