import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type SigningKey } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { chainAccess } from '../supply-chains/chain-policy.js';
import {
  keyPopMessage,
  parseEd25519PublicKey,
  publicKeyHash,
  verifyEd25519,
} from '../trace/signed-commitment.js';
import type { RegisterSigningKeyDto } from './dto.js';

export function keyView(key: SigningKey) {
  return {
    keyRef: key.keyRef,
    chainId: key.chainId,
    organizationId: key.organizationId,
    label: key.label,
    algorithm: key.algorithm,
    publicKey: key.publicKey,
    status: key.status,
    createdAt: key.createdAt,
    activatedAt: key.activatedAt,
    revokedAt: key.revokedAt,
  };
}

/** Organization signing keys. The API stores only public keys: a private key
 * is created and kept by the organization's signer (browser, HSM, remote
 * service). Ledger activation is an operator action that needs the owner
 * MSP's approval, so a key is never usable before the ledger registry holds it. */
@Injectable()
export class SigningKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async context(actor: CommandActor, chainId: string) {
    await chainAccess(this.prisma, actor, chainId);
    const profile = await this.prisma.chainLedgerProfile.findUnique({
      where: { chainId },
    });
    const keys = await this.prisma.signingKey.findMany({
      where: { chainId, organizationId: actor.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    return {
      chainId,
      organizationId: actor.organizationId!,
      bindingDigest: profile?.activeBindingDigest ?? null,
      handoverMode: profile?.handoverMode ?? 'STANDARD',
      keys: keys.map(keyView),
    };
  }

  async register(
    actor: CommandActor,
    chainId: string,
    input: RegisterSigningKeyDto,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      const profile = await tx.chainLedgerProfile.findUnique({
        where: { chainId },
        include: { activeBinding: { include: { state: true } } },
      });
      const digest = profile?.activeBindingDigest;
      if (!digest || profile?.activeBinding?.state?.status !== 'ACTIVE')
        throw new ConflictException('Chuỗi chưa có binding ledger hoạt động');
      try {
        parseEd25519PublicKey(input.publicKey);
      } catch {
        throw new UnprocessableEntityException(
          'Khóa công khai phải là Ed25519 SPKI hợp lệ',
        );
      }
      // The registrant proves it holds the private key for exactly this
      // binding, key reference and organization; a copied public key fails.
      if (
        !verifyEd25519(
          input.publicKey,
          keyPopMessage({
            bindingDigest: digest,
            keyRef: input.keyRef,
            orgRef: actor.organizationId!,
            publicKey: input.publicKey,
          }),
          input.popSignature,
        )
      )
        throw new UnprocessableEntityException(
          'Bằng chứng sở hữu khóa (proof-of-possession) không hợp lệ',
        );
      const hash = publicKeyHash(input.publicKey);
      const duplicate = await tx.signingKey.findFirst({
        where: {
          OR: [
            { bindingDigest: digest, publicKeyHash: hash },
            { keyRef: input.keyRef },
          ],
        },
      });
      if (duplicate) throw new ConflictException('Khóa này đã được đăng ký');
      const key = await tx.signingKey.create({
        data: {
          keyRef: input.keyRef,
          chainId,
          bindingDigest: digest,
          organizationId: actor.organizationId!,
          label: input.label,
          publicKey: input.publicKey,
          publicKeyHash: hash,
          popSignature: input.popSignature,
          registeredBy: actor.sub!,
        },
      });
      return keyView(key);
    });
  }

  async revoke(
    actor: CommandActor,
    chainId: string,
    keyRef: string,
    reason: string,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT key_ref FROM signing_key WHERE key_ref = ${keyRef}::uuid FOR UPDATE`,
      );
      const key = await tx.signingKey.findUnique({ where: { keyRef } });
      if (
        !key ||
        key.chainId !== chainId ||
        key.organizationId !== actor.organizationId
      )
        throw new NotFoundException('Không tìm thấy khóa ký');
      if (key.status === 'REVOKED')
        throw new ConflictException('Khóa ký đã bị thu hồi');
      // From this commit no new intent can be prepared or consumed with the
      // key. If the ledger already holds it, the Worker revokes it there too;
      // signed events not yet delivered are then refused by the ledger.
      const revoked = await tx.signingKey.update({
        where: { keyRef },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokeReason: reason,
          version: { increment: 1 },
        },
      });
      if (key.status === 'ACTIVE')
        await tx.ledgerControlJob.create({
          data: {
            bindingDigest: key.bindingDigest,
            operation: 'SIGNING_KEY_REVOKE',
            signingKeyRef: key.keyRef,
            expectedRevision: 1,
          },
        });
      return keyView(revoked);
    });
  }
}
