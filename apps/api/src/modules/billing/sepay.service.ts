import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { activateEnrollmentTx } from '../enterprise-onboarding/service-activation.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import { settleInvoiceTx } from './billing-core.js';
import {
  sepayConfiguration,
  sepayInvoiceNumber,
  sepayPaymentCode,
  sepayQrUrl,
  sepayRecipientMatches,
  type SepayConfiguration,
  type SepayTransaction,
} from './sepay-protocol.js';
import type { SepayCheckoutView } from './sepay.dto.js';
import {
  sepayGatewayConfiguration,
  sepayGatewayForm,
  type SepaySettlement,
} from './sepay-gateway.js';

@Injectable()
export class SepayService {
  constructor(private readonly db: PrismaService) {}

  async checkout(
    actor: CommandActor,
    invoiceId?: string,
  ): Promise<SepayCheckoutView> {
    if (!actor.sub || !actor.organizationId)
      throw new ForbiddenException('Chỉ chủ doanh nghiệp được mở thanh toán');
    // Payment must work before business activation/ORG_ADMIN exists. Ownership,
    // approval and current account/org status authorize it, not business grants.
    const enrollment = await this.db.enterpriseEnrollment.findUnique({
      where: { organizationId: actor.organizationId },
      include: {
        organization: {
          include: { capabilityRequests: { select: { status: true } } },
        },
        owner: true,
      },
    });
    if (
      !enrollment ||
      enrollment.ownerId !== actor.sub ||
      enrollment.status !== 'APPROVED' ||
      enrollment.owner.accountStatus !== 'ACTIVE' ||
      enrollment.organization.status !== 'ACTIVE'
    )
      throw new ForbiddenException(
        'Chỉ chủ hồ sơ doanh nghiệp đã được duyệt được mở thanh toán',
      );
    const gateway = sepayGatewayConfiguration();
    const bankConfig = gateway ? null : sepayConfiguration();
    const config = gateway ?? bankConfig;
    const empty: SepayCheckoutView = {
      enabled: false,
      mode: null,
      invoiceId: null,
      invoiceNumber: null,
      amount: null,
      status: null,
      dueAt: null,
      paidAt: null,
      simulated: false,
      serviceActive: false,
      bank: null,
      accountNumber: null,
      accountHolder: null,
      paymentCode: null,
      qrUrl: null,
      reviewMessage: null,
      gateway: null,
    };
    if (!config) return empty;
    const subscription = await this.db.subscription.findFirst({
      where: {
        organizationId: actor.organizationId!,
        status: { in: ['PENDING_PAYMENT', 'ACTIVE'] },
      },
    });
    const invoice = invoiceId
      ? await this.db.invoice.findFirst({
          where: { id: invoiceId, organizationId: actor.organizationId! },
        })
      : subscription &&
        (await this.db.invoice.findFirst({
          where: {
            subscriptionId: subscription.id,
            kind: 'INITIAL',
            status: { not: 'VOID' },
          },
          orderBy: { issuedAt: 'desc' },
        }));
    if (!invoice || invoice.currency !== 'VND')
      throw new NotFoundException(
        'Chưa có hóa đơn VND cho hợp đồng đã xác nhận',
      );
    if (invoice.amount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ConflictException('Số tiền hóa đơn vượt giới hạn thanh toán');
    const receipt = await this.db.sepayWebhookReceipt.findFirst({
      where: {
        invoiceId: invoice.id,
        mode: config.mode,
        outcome: 'REVIEW_REQUIRED',
      },
      orderBy: { receivedAt: 'desc' },
    });
    const capabilities = enrollment.organization.capabilityRequests;
    const ready =
      !capabilities.some((r) => r.status === 'PENDING') &&
      capabilities.some((r) => r.status === 'APPROVED');
    return {
      enabled: true,
      mode: config.mode,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: Number(invoice.amount),
      status: invoice.status,
      dueAt: invoice.dueAt.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      simulated:
        invoice.status === 'PAID' ? invoice.simulated : config.mode === 'test',
      serviceActive:
        !!enrollment?.serviceActivatedAt && subscription?.status === 'ACTIVE',
      bank: bankConfig?.bank ?? null,
      accountNumber: bankConfig
        ? (bankConfig.virtualAccount ?? bankConfig.accountNumber)
        : null,
      accountHolder: bankConfig?.accountHolder ?? null,
      paymentCode: sepayPaymentCode(invoice.number),
      qrUrl:
        bankConfig &&
        ready &&
        !receipt &&
        invoice.status === 'ISSUED' &&
        invoice.dueAt > new Date()
          ? sepayQrUrl(bankConfig, invoice.number, invoice.amount)
          : null,
      gateway:
        gateway &&
        ready &&
        !receipt &&
        invoice.status === 'ISSUED' &&
        invoice.dueAt > new Date()
          ? sepayGatewayForm(gateway, invoice)
          : null,
      reviewMessage: !ready
        ? 'Năng lực chưa được xét đầy đủ. Chưa chuyển khoản; liên hệ quản trị để hoàn tất.'
        : receipt
          ? 'Có giao dịch cần đối soát. Không chuyển thêm tiền; liên hệ quản trị kèm số hóa đơn.'
          : null,
    };
  }

  /** Receipt, settlement, subscription, grants and mail outbox share one commit.
   * No bank/Fabric/SMTP call is made here. Failures are retried by SePay with the
   * same transaction id; a lost HTTP response cannot extend a term twice. */
  receive(config: SepayConfiguration, transaction: SepayTransaction) {
    return this.receiveSettlement(config, {
      id: String(transaction.id),
      invoiceNumber: sepayInvoiceNumber(transaction),
      amount: BigInt(transaction.transferAmount),
      posted: Date.parse(
        transaction.transactionDate.replace(' ', 'T') + '+07:00',
      ),
      payloadHash: canonicalSha256(transaction),
      rejection: sepayRecipientMatches(transaction, config)
        ? null
        : 'RECIPIENT_OR_DIRECTION_MISMATCH',
    });
  }

  receiveSettlement(
    config: { mode: 'test' | 'live' },
    transaction: SepaySettlement,
  ) {
    const payloadHash = transaction.payloadHash;
    return this.db.$transaction(
      async (tx) => {
        // Global audit lock is always first, including ignored/provider commands.
        await lockPlatformAudit(tx);
        const prior = await tx.sepayWebhookReceipt.findUnique({
          where: {
            mode_transactionId: {
              mode: config.mode,
              transactionId: String(transaction.id),
            },
          },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw new ConflictException(
              'Giao dịch SePay đã có nội dung khác; cần đối soát',
            );
          return;
        }
        const invoiceNumber = transaction.invoiceNumber;
        let invoice = invoiceNumber
          ? await tx.invoice.findUnique({ where: { number: invoiceNumber } })
          : null;
        if (invoice) {
          await tx.$queryRaw`SELECT id FROM invoice WHERE id=${invoice.id}::uuid FOR UPDATE`;
          invoice = await tx.invoice.findUniqueOrThrow({
            where: { id: invoice.id },
          });
        }
        const record = async (
          outcome: 'MATCHED' | 'IGNORED' | 'REVIEW_REQUIRED',
          reason: string,
        ) => {
          const receipt = await tx.sepayWebhookReceipt.create({
            data: {
              mode: config.mode,
              transactionId: String(transaction.id),
              payloadHash,
              invoiceId: invoice?.id ?? null,
              outcome,
              reason,
            },
          });
          await appendPlatformAudit(tx, {
            actor: null,
            action: 'SEPAY_WEBHOOK_RECEIVED',
            subjectType: 'SEPAY_WEBHOOK_RECEIPT',
            subjectId: receipt.id,
            organizationId: invoice?.organizationId ?? null,
            reason,
            details: {
              mode: config.mode,
              transactionId: String(transaction.id),
              invoiceId: invoice?.id ?? null,
              outcome,
            },
          });
        };
        if (transaction.rejection)
          return record(
            transaction.id.startsWith('PG:') ? 'REVIEW_REQUIRED' : 'IGNORED',
            transaction.rejection,
          );
        if (!invoice)
          return record('REVIEW_REQUIRED', 'INVOICE_CODE_NOT_MATCHED');
        if (invoice.status !== 'ISSUED')
          return record('REVIEW_REQUIRED', 'INVOICE_ALREADY_PROCESSED');
        if (invoice.currency !== 'VND' || invoice.amount !== transaction.amount)
          return record('REVIEW_REQUIRED', 'AMOUNT_OR_CURRENCY_MISMATCH');
        const posted = transaction.posted;
        if (
          posted < Math.floor(invoice.issuedAt.getTime() / 1000) * 1000 ||
          posted > invoice.dueAt.getTime() ||
          posted > Date.now() + 120000
        )
          return record('REVIEW_REQUIRED', 'TRANSFER_OUTSIDE_INVOICE_WINDOW');
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: invoice.organizationId },
          include: {
            profile: true,
            capabilityRequests: true,
            enterpriseEnrollment: {
              include: { serviceOrder: true, owner: true },
            },
          },
        });
        const enrollment = organization.enterpriseEnrollment;
        const subscription = invoice.subscriptionId
          ? await tx.subscription.findUnique({
              where: { id: invoice.subscriptionId },
            })
          : null;
        const requests = organization.capabilityRequests;
        if (
          organization.status !== 'ACTIVE' ||
          !enrollment ||
          enrollment.status !== 'APPROVED' ||
          enrollment.owner.accountStatus !== 'ACTIVE' ||
          requests.some((r) => r.status === 'PENDING') ||
          !requests.some((r) => r.status === 'APPROVED')
        )
          return record('REVIEW_REQUIRED', 'ENTERPRISE_REVIEW_NOT_READY');
        if (
          !subscription ||
          subscription.organizationId !== invoice.organizationId ||
          !['PENDING_PAYMENT', 'ACTIVE'].includes(subscription.status)
        )
          return record('REVIEW_REQUIRED', 'SUBSCRIPTION_NOT_PAYABLE');
        const order = enrollment.serviceOrder;
        if (
          invoice.kind === 'INITIAL' &&
          (!order ||
            subscription.sourceOrderId !== order.id ||
            order.status !== 'AWAITING_PAYMENT' ||
            BigInt(order.amount) !== invoice.amount ||
            organization.participationStatus !== 'CHAIN_OWNER')
        )
          return record('REVIEW_REQUIRED', 'CONTRACT_NOT_PAYABLE');
        const paid = await settleInvoiceTx(tx, null, invoice.id, {
          provider: config.mode === 'test' ? 'SIMULATION' : 'SEPAY',
          version: invoice.version,
          reference: `SEPAY:${config.mode}:${transaction.id}`,
          note:
            config.mode === 'test'
              ? 'SePay Test mode — không thu tiền thật'
              : 'SePay xác nhận giao dịch ngân hàng',
        });
        if (invoice.kind === 'INITIAL' && order) {
          await tx.enterpriseServiceOrder.update({
            where: { id: order.id },
            data: {
              status: config.mode === 'test' ? 'PAID_SIMULATED' : 'PAID',
              paidAt: paid.paidAt,
              version: { increment: 1 },
            },
          });
          if (!enrollment.serviceActivatedAt) {
            const createChain = await activateEnrollmentTx(
              tx,
              { ...enrollment, organization },
              null,
              'Tự kích hoạt sau xác nhận SePay',
            );
            await appendPlatformAudit(tx, {
              actor: null,
              action: 'ENTERPRISE_SERVICE_ACTIVATED',
              subjectType: 'ENTERPRISE_ENROLLMENT',
              subjectId: enrollment.id,
              organizationId: organization.id,
              reason: 'Tự kích hoạt sau xác nhận SePay',
              details: {
                provider: 'SEPAY',
                simulated: config.mode === 'test',
                paymentVerified: config.mode === 'live',
                createChain,
              },
            });
          }
          await queueContract(
            tx,
            enrollment.id,
            order.billingEmail,
            order.contractText,
            order.contractDigest,
            config.mode,
            order.contractPdf,
            order.contractPdfHash,
          );
        }
        await appendPlatformAudit(tx, {
          actor: null,
          action: 'SERVICE_PAYMENT_CONFIRMED',
          subjectType: 'INVOICE',
          subjectId: invoice.id,
          organizationId: invoice.organizationId,
          details: {
            simulated: config.mode === 'test',
            amount: invoice.amount.toString(),
          },
        });
        return record('MATCHED', 'INVOICE_SETTLED');
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }
}

async function queueContract(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
  recipient: string,
  text: string,
  digest: string,
  mode: 'test' | 'live',
  pdf: Uint8Array | null,
  pdfSha256: string | null,
) {
  if (
    await tx.enterpriseMail.findFirst({
      where: { enrollmentId, kind: 'CONTRACT' },
    })
  )
    return;
  await tx.enterpriseMail.create({
    data: {
      enrollmentId,
      kind: 'CONTRACT',
      recipient,
      subject:
        mode === 'test'
          ? 'AgriTrace — Hợp đồng sau thanh toán thử nghiệm SePay'
          : 'AgriTrace — Xác nhận thanh toán và hợp đồng dịch vụ',
      text: `${mode === 'test' ? 'Giao dịch SePay thử nghiệm đã được xác nhận; không thu tiền thật.' : 'Giao dịch ngân hàng đã được SePay xác nhận.'} Dịch vụ đã được kích hoạt theo gói đã chọn. Bản hợp đồng đã xác nhận được đính kèm email này. Mã đối chiếu: ${digest}. Trạng thái kết nối blockchain được theo dõi riêng tại trang Dịch vụ.`,
      attachment: pdf ? null : text,
      attachmentPdf: pdf ? new Uint8Array(pdf) : null,
      attachmentPdfHash: pdfSha256,
    },
  });
}
