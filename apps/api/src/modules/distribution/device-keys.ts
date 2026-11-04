import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { parseEd25519PublicKey, verifyEd25519 } from '../trace/signed-commitment.js';
import { encryptOtp, otpSecret } from '../enterprise-onboarding/registration-otp.service.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import type { TransferKeyInput } from './dto.js';

/**
 * Personal device signing keys. The phone generates the key on the first
 * sign-in and registers only its public key with a proof of possession; the
 * key stays PENDING until the account owner enters the code emailed to the
 * account address, so a stolen password alone never yields a signing key.
 */
const PURPOSE = 'agritrace:signing-key-otp:v1';
const KEY_DOMAIN = 'agritrace:distribution-key:1';
const codeDigest = (row: { id: string; keyId: string; userId: string }, code: string) =>
  createHmac('sha256', otpSecret()).update(PURPOSE + '\0' + JSON.stringify([row.id, row.keyId, row.userId, code])).digest('hex');
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};
const keyMessage = (body: unknown) => Buffer.from(`${KEY_DOMAIN}\0${canonicalize(body)}`, 'utf8');

async function issueCode(tx: Prisma.TransactionClient, actor: CommandActor, keyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`signing-key-otp:${actor.sub}`},0))`;
  const last = await tx.signingKeyVerification.findFirst({ where: { userId: actor.sub! }, orderBy: { createdAt: 'desc' } });
  const hour = await tx.signingKeyVerification.count({ where: { userId: actor.sub!, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if ((last && last.createdAt.getTime() + 60_000 > Date.now()) || hour >= 5)
    throw new HttpException('Chờ ít nhất 60 giây giữa hai lần gửi mã. Tối đa 5 mã mỗi giờ.', 429);
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.sub! }, select: { email: true } });
  await tx.signingKeyVerification.updateMany({ where: { keyId, verifiedAt: null, supersededAt: null }, data: { supersededAt: new Date() } });
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const mail = await tx.enterpriseMail.create({
    data: {
      userId: actor.sub!,
      kind: 'SIGNING_KEY_OTP',
      recipient: user.email,
      subject: 'AgriTrace — Mã xác minh khóa ký trên thiết bị mới',
      text: 'Tài khoản của bạn vừa tạo khóa ký bàn giao trên một thiết bị. Nhập mã để bật khóa; mã có hiệu lực 10 phút. Nếu không phải bạn, đừng nhập mã và báo ngay cho quản trị doanh nghiệp.',
      otpCiphertext: encryptOtp(code),
    },
  });
  const id = randomUUID();
  const row = await tx.signingKeyVerification.create({
    data: { id, keyId, userId: actor.sub!, mailId: mail.id, codeDigest: codeDigest({ id, keyId, userId: actor.sub! }, code), expiresAt: new Date(Date.now() + 600_000) },
  });
  return { email: maskEmail(user.email), expiresAt: row.expiresAt.toISOString(), resendAfter: new Date(row.createdAt.getTime() + 60_000).toISOString() };
}

/** Registers a PENDING personal key for the signed-in member and emails its code. */
export async function requestDeviceKey(tx: Prisma.TransactionClient, actor: CommandActor, input: TransferKeyInput) {
  await enterpriseAuthority(tx, actor, 'distribution.sign', undefined, undefined, true);
  try {
    parseEd25519PublicKey(input.publicKey);
  } catch {
    throw new UnprocessableEntityException('Khóa công khai Ed25519 không hợp lệ');
  }
  if (!verifyEd25519(input.publicKey, keyMessage({ id: input.id, organizationId: actor.organizationId, publicKey: input.publicKey }), input.popSignature))
    throw new UnprocessableEntityException('Bằng chứng sở hữu khóa không hợp lệ');
  // One device enrollment at a time: an unconfirmed earlier key is dropped.
  await tx.distributionKey.updateMany({ where: { userId: actor.sub!, status: 'PENDING' }, data: { status: 'REVOKED' } });
  const key = await tx.distributionKey.create({
    data: { id: input.id, organizationId: actor.organizationId!, publicKey: input.publicKey, label: input.label, userId: actor.sub!, status: 'PENDING' },
  });
  return { record: { id: key.id, status: key.status, ...(await issueCode(tx, actor, key.id)) } };
}

export async function resendDeviceKeyCode(tx: Prisma.TransactionClient, actor: CommandActor, id: string) {
  const key = await tx.distributionKey.findFirst({ where: { id, userId: actor.sub!, organizationId: actor.organizationId! } });
  if (!key) throw new NotFoundException('Không tìm thấy khóa của bạn');
  if (key.status !== 'PENDING') throw new ConflictException('Khóa không còn chờ xác minh');
  return { record: { id, status: key.status, ...(await issueCode(tx, actor, id)) } };
}

/**
 * Checks the code. A wrong attempt is committed (and journaled) as a result
 * with verified=false, and the controller turns it into an error, so the
 * attempt still counts; five wrong codes end that code.
 */
export async function verifyDeviceKey(tx: Prisma.TransactionClient, actor: CommandActor, id: string, code: string) {
  const key = await tx.distributionKey.findFirst({ where: { id, userId: actor.sub!, organizationId: actor.organizationId! } });
  if (!key) throw new NotFoundException('Không tìm thấy khóa của bạn');
  if (key.status === 'ACTIVE') return { record: { id, status: key.status, verified: true } };
  if (key.status !== 'PENDING') throw new ConflictException('Khóa đã bị thu hồi; tạo khóa mới');
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM signing_key_verification WHERE key_id=${id}::uuid AND verified_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
  const v = row && await tx.signingKeyVerification.findUniqueOrThrow({ where: { id: row.id } });
  if (!v || v.expiresAt <= new Date() || v.attempts >= 5) return { record: { id, status: key.status, verified: false } };
  if (!timingSafeEqual(Buffer.from(v.codeDigest, 'hex'), Buffer.from(codeDigest(v, code), 'hex'))) {
    await tx.signingKeyVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
    return { record: { id, status: key.status, verified: false } };
  }
  const now = new Date();
  await tx.signingKeyVerification.update({ where: { id: v.id }, data: { verifiedAt: now } });
  await tx.distributionKey.update({ where: { id }, data: { status: 'ACTIVE', verifiedAt: now } });
  return { record: { id, status: 'ACTIVE', verified: true } };
}

export const WRONG_CODE = 'Mã không đúng, đã hết hạn hoặc đã nhập sai 5 lần. Gửi lại mã mới.';
