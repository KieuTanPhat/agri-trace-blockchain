import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { quantity, quantityIsReconciled } from '../../common/quantity.js';
import { isPastExpiry } from '../../common/expiry-date.js';
import { TraceService } from '../trace/trace.service.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { activeSite } from '../distribution/distribution-inventory.js';
import { settingNumber } from '../billing/billing-core.js';
import { lotChainId } from '../lots/lot-origin.js';
import { activeChainBindingDigest } from '../ledger/ledger-permissions.js';
import { downstreamLots, upstreamLots } from './processing-lineage.js';
import type {
  AddProcessingInputsInput,
  CancelProcessingInput,
  CompleteProcessingInput,
  CreateMaterialReceiptInput,
  CreateProcessingRunInput,
  MaterialReceiptQuery,
  ProcessingLogInput,
  ProcessingMaterialLines,
  CreateUnitConversionInput,
  ProcessingQuery,
  ProcessingVersionInput,
  RevokeUnitConversionInput,
} from './processing.dto.js';

type Tx = Prisma.TransactionClient;
const BLOCKED_STATES = ['RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED', 'SOLD', 'CONSUMED'];
const RUN_INCLUDE = {
  inputs: {
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          unit: true,
          currentState: true,
          product: { select: { productName: true } },
          organization: { select: { name: true } },
        },
      },
    },
  },
  outputs: {
    include: {
      product: { select: { productName: true } },
      lot: { select: { id: true, lotCode: true, traceQr: { select: { traceToken: true } } } },
    },
  },
  losses: true,
  externalInputs: {
    include: { receipt: { select: { code: true, materialName: true, supplierName: true, documentNo: true } } },
    orderBy: { createdAt: 'asc' },
  },
  logs: { orderBy: { occurredAt: 'asc' } },
  product: { select: { productName: true } },
  chain: { select: { name: true } },
} as const;
type RunRow = Prisma.ProcessingRunGetPayload<{ include: typeof RUN_INCLUDE }>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(3));
/** `held` is what the run's own organization still holds of each input at the
 * run site; other holders' stock is never shown to the processor. */
export const runView = (r: RunRow, held?: Map<string, string>) => ({
  id: r.id,
  code: r.code,
  chainId: r.chainId,
  chainName: r.chain.name,
  siteId: r.siteId,
  processType: r.processType,
  baseUnit: r.baseUnit,
  recipe: r.recipe,
  note: r.note,
  status: r.status,
  productId: r.productId,
  productName: r.product?.productName ?? null,
  startedAt: r.startedAt?.toISOString() ?? null,
  inputTotal: num(r.inputTotal),
  outputTotal: num(r.outputTotal),
  lossTotal: num(r.lossTotal),
  variancePercent: num(r.variancePercent),
  completedAt: r.completedAt?.toISOString() ?? null,
  cancelledAt: r.cancelledAt?.toISOString() ?? null,
  cancelReason: r.cancelReason,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  inputs: r.inputs.map((i) => ({
    lotId: i.lotId,
    lotCode: i.lot.lotCode,
    productName: i.lot.product.productName,
    sourceOrganization: i.lot.organization.name,
    quantity: i.quantity.toFixed(3),
    unit: i.unit,
    currentState: i.lot.currentState,
    availableQuantity: held?.get(i.lotId) ?? null,
  })),
  outputs: r.outputs.map((o) => ({
    id: o.id,
    productId: o.productId,
    productName: o.product.productName,
    kind: o.kind,
    quantity: o.quantity.toFixed(3),
    unit: o.unit,
    baseQuantity: o.baseQuantity.toFixed(3),
    lotName: o.lotName,
    grade: o.grade,
    packaging: o.packaging,
    packageCount: o.packageCount,
    expiryDate: o.expiryDate?.toISOString().slice(0, 10) ?? null,
    lotId: o.lot?.id ?? null,
    lotCode: o.lot?.lotCode ?? null,
    traceToken: o.lot?.traceQr?.traceToken ?? null,
  })),
  losses: r.losses.map((l) => ({
    reason: l.reason,
    quantity: l.quantity.toFixed(3),
    note: l.note,
  })),
  externalInputs: r.externalInputs.map((i) => ({
    receiptId: i.receiptId,
    receiptCode: i.receipt.code,
    materialName: i.receipt.materialName,
    supplierName: i.receipt.supplierName,
    documentNo: i.receipt.documentNo,
    quantity: i.quantity.toFixed(3),
    unit: i.unit,
  })),
  logs: r.logs.map(logView),
});

type LogRow = { id: string; step: string; occurredAt: Date; note: string; correctsId: string | null; recordedBy: string; createdAt: Date };
export const logView = (l: LogRow) => ({
  id: l.id,
  step: l.step,
  occurredAt: l.occurredAt.toISOString(),
  note: l.note,
  correctsId: l.correctsId,
  recordedBy: l.recordedBy,
  createdAt: l.createdAt.toISOString(),
});

type ReceiptRow = Prisma.MaterialReceiptGetPayload<object>;
/** External stock left on a receipt (AgriTrace receipts hold none of their own). */
export const receiptAvailable = (r: Pick<ReceiptRow, 'source' | 'quantity' | 'reserved' | 'consumed'>) =>
  r.source === 'EXTERNAL' ? r.quantity.sub(r.reserved).sub(r.consumed) : new Prisma.Decimal(0);
const receiptView = (r: ReceiptRow, siteName: string | null, hasEvidence: boolean) => ({
  id: r.id,
  code: r.code,
  source: r.source,
  siteId: r.siteId,
  siteName,
  transferId: r.transferId,
  lotId: r.lotId,
  materialName: r.materialName,
  supplierName: r.supplierName,
  documentNo: r.documentNo,
  receivedAt: r.receivedAt.toISOString(),
  quantity: r.quantity.toFixed(3),
  unit: r.unit,
  reserved: r.reserved.toFixed(3),
  consumed: r.consumed.toFixed(3),
  available: receiptAvailable(r).toFixed(3),
  expiryDate: r.expiryDate?.toISOString().slice(0, 10) ?? null,
  note: r.note,
  hasEvidence,
  createdAt: r.createdAt.toISOString(),
});

const today = () =>
  new Date(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) +
      'T00:00:00Z',
  );
const code = (prefix: string) =>
  `${prefix}-${today().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`;

type Conversion = { productId: string; unit: string; baseUnit: string; factor: Prisma.Decimal };
const sameUnit = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Base quantity of an output: the quantity itself in the base unit, otherwise
 * the quantity times the product's declared factor. The DB recomputes the same
 * value on insert, so a client cannot claim an arbitrary weight. */
export function outputBaseQuantity(
  output: { productId: string; quantity: Prisma.Decimal; unit: string },
  baseUnit: string,
  conversions: Conversion[],
  productName = 'thành phẩm',
) {
  if (sameUnit(output.unit, baseUnit)) return output.quantity;
  const conversion = conversions.find(
    (c) => c.productId === output.productId && sameUnit(c.unit, output.unit) && sameUnit(c.baseUnit, baseUnit),
  );
  if (!conversion)
    throw new UnprocessableEntityException(
      `${productName} chưa khai hệ số quy đổi từ ${output.unit} sang ${baseUnit}; khai báo trong mục Hệ số quy đổi trước khi lập lệnh`,
    );
  return output.quantity.mul(conversion.factor).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

const conversionView = (c: {
  id: string; productId: string; unit: string; baseUnit: string; factor: Prisma.Decimal; note: string | null;
  createdAt: Date; revokedAt: Date | null; revokeReason: string | null; product: { productName: string };
}) => ({
  id: c.id,
  productId: c.productId,
  productName: c.product.productName,
  unit: c.unit,
  baseUnit: c.baseUnit,
  factor: c.factor.toString(),
  note: c.note,
  createdAt: c.createdAt.toISOString(),
  revokedAt: c.revokedAt?.toISOString() ?? null,
  revokeReason: c.revokeReason,
});

/** Inputs must equal outputs (in base unit) plus losses within the configured
 * tolerance. Returns the totals recorded on the run. */
export async function massBalance(
  db: Tx,
  inputs: Prisma.Decimal[],
  outputs: Prisma.Decimal[],
  losses: Prisma.Decimal[],
) {
  const sum = (xs: Prisma.Decimal[]) =>
    xs.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
  const input = sum(inputs);
  const output = sum(outputs);
  const loss = sum(losses);
  const tolerance = await settingNumber(db, 'processing.massBalanceTolerancePercent', 0);
  const variance = input.sub(output).sub(loss);
  if (variance.abs().gt(input.mul(tolerance).div(100)))
    throw new UnprocessableEntityException(
      `Chưa cân bằng khối lượng: đầu vào ${input.toFixed(3)} ≠ thành phẩm ${output.toFixed(3)} + hao hụt ${loss.toFixed(3)} (sai lệch cho phép ${tolerance}%)`,
    );
  return {
    input,
    output,
    loss,
    variancePercent: input.isZero() ? new Prisma.Decimal(0) : variance.div(input).mul(100).toDecimalPlaces(3),
  };
}

@Injectable()
export class ProcessingService {
  constructor(
    private readonly db: PrismaService,
    private readonly trace: TraceService,
  ) {}

  async list(actor: CommandActor, query: ProcessingQuery) {
    const auth = await enterpriseAuthority(this.db, actor, 'processing.read');
    const rows = await this.db.processingRun.findMany({
      where: {
        organizationId: actor.organizationId!,
        ...(query.status ? { status: query.status } : {}),
        ...(auth.primary
          ? {}
          : {
              OR: auth.matching.map((r) => ({
                chainId: { in: r.chainIds },
                siteId: { in: r.siteIds },
              })),
            }),
      },
      include: RUN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items: rows.map((row) => runView(row)) };
  }

  async get(actor: CommandActor, id: string) {
    const row = await this.db.processingRun.findUnique({ where: { id }, include: RUN_INCLUDE });
    if (!row || row.organizationId !== actor.organizationId)
      throw new NotFoundException('Không tìm thấy lệnh chế biến');
    await enterpriseAuthority(this.db, actor, 'processing.read', row.chainId, row.siteId);
    const stocks = await this.db.lotSiteHolding.findMany({
      where: {
        organizationId: row.organizationId,
        siteId: row.siteId,
        lotId: { in: row.inputs.map((i) => i.lotId) },
      },
    });
    return {
      record: runView(row, new Map(stocks.map((s) => [s.lotId, s.quantity.toFixed(3)]))),
    };
  }

  /** Lots this organization holds at its processing sites, ready to be used. */
  async materials(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'processing.read');
    const scoped = auth.primary
      ? undefined
      : auth.matching.map((r) => ({ chainIds: r.chainIds, siteIds: r.siteIds }));
    const stocks = await this.db.lotSiteHolding.findMany({
      where: {
        organizationId: actor.organizationId!,
        quantity: { gt: 0 },
        ...(scoped ? { siteId: { in: scoped.flatMap((r) => r.siteIds) } } : {}),
      },
    });
    const sites = await this.db.enterpriseSite.findMany({
      where: {
        organizationId: actor.organizationId!,
        id: { in: stocks.map((s) => s.siteId) },
        kind: { in: ['PROCESSING', 'PACKING'] },
      },
      select: { id: true, name: true },
    });
    const lots = await this.db.lot.findMany({
      where: { id: { in: stocks.map((s) => s.lotId) } },
      include: { product: { select: { productName: true } }, organization: { select: { name: true } }, harvest: { include: { cycle: true } }, processingRun: true },
    });
    return {
      items: stocks
        .filter((s) => sites.some((x) => x.id === s.siteId))
        .flatMap((s) => {
          const lot = lots.find((l) => l.id === s.lotId);
          if (!lot) return [];
          // A delegated member sees a lot only where one grant covers both
          // its chain and the site holding it.
          const chainId = lotChainId(lot);
          if (scoped && !scoped.some((r) => r.siteIds.includes(s.siteId) && !!chainId && r.chainIds.includes(chainId)))
            return [];
          return [{
            lotId: lot.id,
            lotCode: lot.lotCode,
            productName: lot.product.productName,
            sourceOrganization: lot.organization.name,
            chainId: lotChainId(lot) ?? null,
            siteId: s.siteId,
            siteName: sites.find((x) => x.id === s.siteId)!.name,
            available: s.quantity.sub(s.reserved).sub(s.quarantined).toFixed(3),
            unit: lot.unit,
            currentState: lot.currentState,
            expiryDate: lot.expiryDate?.toISOString().slice(0, 10) ?? null,
            blocked: BLOCKED_STATES.includes(lot.currentState) || isPastExpiry(lot.expiryDate),
          }];
        }),
    };
  }

  async lineage(actor: CommandActor, lotId: string) {
    const lot = await this.db.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw new NotFoundException('Không tìm thấy lô');
    const admin = ['SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_OPERATOR', 'PLATFORM_CASE_MANAGER'].includes(actor.role);
    if (!admin) {
      await enterpriseAuthority(this.db, actor, 'trace.read');
      const holds = await this.db.lotHolding.findUnique({
        where: { lotId_organizationId: { lotId, organizationId: actor.organizationId! } },
      });
      if (lot.farmOrgId !== actor.organizationId && !holds)
        throw new ForbiddenException('Lô nằm ngoài phạm vi doanh nghiệp');
    }
    // Enterprises learn which lots are linked, but not other holders' stock
    // or state; platform staff see everything for recall work.
    const own = <T extends { organizationId: string; availableQuantity: string | null; currentState: string | null }>(rows: T[]) =>
      admin
        ? rows
        : rows.map((r) =>
            r.organizationId === actor.organizationId
              ? r
              : { ...r, availableQuantity: null, currentState: null },
          );
    return {
      lotId,
      upstream: own(await upstreamLots(this.db, lotId)),
      downstream: own(await downstreamLots(this.db, [lotId])),
    };
  }

  /** Material lines are checked against what the run site holds. Returns the
   * origin cycles of the AgriTrace lots and the external receipts used. */
  private async checkMaterials(
    tx: Tx,
    run: { organizationId: string; chainId: string; siteId: string; baseUnit: string },
    lines: ProcessingMaterialLines,
    existing: { lotIds: string[]; receiptIds: string[] } = { lotIds: [], receiptIds: [] },
  ) {
    const lotIds = lines.inputs.map((i) => i.lotId);
    const receiptIds = lines.externalInputs.map((i) => i.receiptId);
    if (new Set([...lotIds, ...existing.lotIds]).size !== lotIds.length + existing.lotIds.length ||
        new Set([...receiptIds, ...existing.receiptIds]).size !== receiptIds.length + existing.receiptIds.length)
      throw new UnprocessableEntityException('Mỗi nguyên liệu chỉ khai báo một lần trong lệnh');
    const lots = await tx.lot.findMany({
      where: { id: { in: lotIds } },
      include: { harvest: { include: { cycle: true } }, processingRun: true },
    });
    const originCycles: string[] = [];
    const bindings: string[] = [];
    for (const line of lines.inputs) {
      const lot = lots.find((l) => l.id === line.lotId);
      if (!lot) throw new NotFoundException('Không tìm thấy lô nguyên liệu');
      if (lotChainId(lot) !== run.chainId)
        throw new UnprocessableEntityException(`Lô ${lot.lotCode} không thuộc chuỗi của lệnh`);
      if (lot.unit !== run.baseUnit)
        throw new UnprocessableEntityException(`Lô ${lot.lotCode} dùng đơn vị ${lot.unit}, khác đơn vị cơ sở ${run.baseUnit}`);
      if (BLOCKED_STATES.includes(lot.currentState) || isPastExpiry(lot.expiryDate))
        throw new ConflictException(`Lô ${lot.lotCode} đã hết hạn, bị thu hồi hoặc không còn dùng được`);
      await this.requireStock(tx, lot.id, run.organizationId, run.siteId, quantity(line.quantity));
      const origin = lot.harvest?.cycleId ?? lot.processingRun?.originCycleId;
      if (origin) originCycles.push(origin);
      else if (lot.processingRun?.bindingDigest) bindings.push(lot.processingRun.bindingDigest);
      else if (!lot.processingRun) throw new ConflictException(`Lô ${lot.lotCode} chưa xác định được vụ gốc`);
    }
    const receipts = await tx.materialReceipt.findMany({ where: { id: { in: receiptIds } } });
    for (const line of lines.externalInputs) {
      const receipt = receipts.find((r) => r.id === line.receiptId);
      if (!receipt || receipt.organizationId !== run.organizationId || receipt.source !== 'EXTERNAL')
        throw new NotFoundException('Không tìm thấy phiếu nhập nguyên liệu ngoài');
      if (receipt.siteId !== run.siteId)
        throw new UnprocessableEntityException(`Phiếu ${receipt.code} nhập vào cơ sở khác`);
      if (receipt.unit !== run.baseUnit)
        throw new UnprocessableEntityException(`Phiếu ${receipt.code} dùng đơn vị ${receipt.unit}, khác đơn vị cơ sở ${run.baseUnit}`);
      if (isPastExpiry(receipt.expiryDate))
        throw new ConflictException(`Nguyên liệu phiếu ${receipt.code} đã hết hạn`);
      if (!(await this.receiptHasEvidence(tx, receipt.id)))
        throw new ConflictException(`Phiếu ${receipt.code} chưa có ảnh chứng từ; tải ảnh hóa đơn hoặc giấy kiểm nghiệm trước`);
      if (receiptAvailable(receipt).lt(quantity(line.quantity)))
        throw new ConflictException(`Phiếu ${receipt.code} không còn đủ lượng khả dụng`);
    }
    return { originCycles, bindings, receipts };
  }

  private receiptHasEvidence(tx: Tx, receiptId: string) {
    return tx.traceEvidence
      .count({ where: { entityType: 'MATERIAL_RECEIPT', entityId: receiptId, withdrawal: { is: null } } })
      .then((n) => n > 0);
  }

  /** Processed events stay on one binding: the inputs' origin cycles, or the
   * chain binding of a run planned only from external material. */
  private async assertOneBinding(tx: Tx, originCycles: string[], runBindings: Array<string | null> = []) {
    const contexts = originCycles.length ? await tx.cycleLedgerContext.findMany({ where: { cycleId: { in: originCycles } } }) : [];
    const digests = new Set(contexts.map((c) => c.bindingDigest));
    for (const b of runBindings) if (b) digests.add(b);
    if (digests.size > 1 || (contexts.length > 0 && new Set(originCycles).size !== new Set(contexts.map((c) => c.cycleId)).size))
      throw new ConflictException('Các nguyên liệu ghi trên các binding sổ cái khác nhau; tách thành nhiều lệnh');
  }

  private async reserve(tx: Tx, run: { organizationId: string; siteId: string }, lotLines: Array<{ lotId: string; quantity: Prisma.Decimal }>, externalLines: Array<{ receiptId: string; quantity: Prisma.Decimal }>) {
    for (const line of [...lotLines].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
      await this.requireStock(tx, line.lotId, run.organizationId, run.siteId, line.quantity);
      await tx.lotHolding.update({
        where: { lotId_organizationId: { lotId: line.lotId, organizationId: run.organizationId } },
        data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
      });
      await tx.lotSiteHolding.update({
        where: { lotId_organizationId_siteId: { lotId: line.lotId, organizationId: run.organizationId, siteId: run.siteId } },
        data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
      });
    }
    for (const line of [...externalLines].sort((a, b) => a.receiptId.localeCompare(b.receiptId))) {
      await tx.$queryRaw`SELECT id FROM material_receipt WHERE id=${line.receiptId}::uuid FOR UPDATE`;
      const receipt = await tx.materialReceipt.findUniqueOrThrow({ where: { id: line.receiptId } });
      if (receiptAvailable(receipt).lt(line.quantity))
        throw new ConflictException(`Phiếu ${receipt.code} không còn đủ lượng khả dụng`);
      await tx.materialReceipt.update({
        where: { id: receipt.id },
        data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
      });
    }
  }

  private async release(tx: Tx, run: { organizationId: string; siteId: string }, lotLines: Array<{ lotId: string; quantity: Prisma.Decimal }>, externalLines: Array<{ receiptId: string; quantity: Prisma.Decimal }>) {
    for (const line of lotLines) {
      await tx.lotHolding.update({
        where: { lotId_organizationId: { lotId: line.lotId, organizationId: run.organizationId } },
        data: { reserved: { decrement: line.quantity }, version: { increment: 1 } },
      });
      await tx.lotSiteHolding.update({
        where: { lotId_organizationId_siteId: { lotId: line.lotId, organizationId: run.organizationId, siteId: run.siteId } },
        data: { reserved: { decrement: line.quantity }, version: { increment: 1 } },
      });
    }
    for (const line of externalLines)
      await tx.materialReceipt.update({
        where: { id: line.receiptId },
        data: { reserved: { decrement: line.quantity }, version: { increment: 1 } },
      });
  }

  private async lockRun(tx: Tx, actor: CommandActor, id: string, version: number, statuses: string[]) {
    await tx.$queryRaw`SELECT id FROM processing_run WHERE id=${id}::uuid FOR UPDATE`;
    const run = await tx.processingRun.findUnique({
      where: { id },
      include: { inputs: true, externalInputs: true, outputs: true, losses: true, logs: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!run || run.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy lệnh chế biến');
    if (!statuses.includes(run.status) || run.version !== version)
      throw new ConflictException('Lệnh chế biến đã được xử lý hoặc đã thay đổi');
    await enterpriseAuthority(tx, actor, 'processing.write', run.chainId, run.siteId, true);
    return run;
  }

  private async requireProcessor(tx: Tx, organizationId: string) {
    if (!(await tx.organizationCapability.findFirst({ where: { organizationId, code: 'PROCESSOR', revokedAt: null } })))
      throw new ForbiddenException('Tổ chức chưa được duyệt hoặc không còn năng lực chế biến');
  }

  /** Lập kế hoạch: main product, site and materials. Nothing is reserved yet. */
  create(actor: CommandActor, input: CreateProcessingRunInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'processing.write', input.chainId, input.siteId, true);
      const organizationId = actor.organizationId!;
      await this.requireProcessor(tx, organizationId);
      const site = await activeSite(tx, organizationId, input.siteId);
      if (!['PROCESSING', 'PACKING'].includes(site.kind))
        throw new UnprocessableEntityException('Chọn cơ sở loại chế biến hoặc đóng gói');
      if (!input.inputs.length && !input.externalInputs.length)
        throw new UnprocessableEntityException('Chọn ít nhất một nguyên liệu');
      const product = await tx.product.findFirst({ where: { id: input.productId, organizationId, status: 'ACTIVE' } });
      if (!product) throw new UnprocessableEntityException('Sản phẩm chính phải là sản phẩm đang hoạt động của doanh nghiệp');
      const runLike = { organizationId, chainId: input.chainId, siteId: input.siteId, baseUnit: input.baseUnit };
      const { originCycles, bindings } = await this.checkMaterials(tx, runLike, input);
      await this.assertOneBinding(tx, originCycles, bindings);
      const bindingDigest = originCycles.length ? null : bindings[0] ?? (await activeChainBindingDigest(tx, input.chainId));
      if (!originCycles.length && !bindingDigest)
        throw new ConflictException('Chuỗi cần binding Fabric hoạt động để chế biến nguyên liệu ngoài');
      const run = await tx.processingRun.create({
        data: {
          code: code('PR'),
          organizationId,
          chainId: input.chainId,
          siteId: input.siteId,
          productId: product.id,
          processType: input.processType,
          baseUnit: input.baseUnit,
          recipe: input.recipe || null,
          note: input.note || null,
          originCycleId: [...originCycles].sort()[0] ?? null,
          bindingDigest,
          createdBy: actor.sub!,
        },
      });
      if (input.inputs.length)
        await tx.processingInput.createMany({
          data: input.inputs.map((i) => ({ runId: run.id, lotId: i.lotId, quantity: quantity(i.quantity), unit: input.baseUnit })),
        });
      if (input.externalInputs.length)
        await tx.processingExternalInput.createMany({
          data: input.externalInputs.map((i) => ({ runId: run.id, receiptId: i.receiptId, quantity: quantity(i.quantity), unit: input.baseUnit })),
        });
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE })) };
    });
  }

  /** Bắt đầu: reserve every material so it cannot leave the site meanwhile. */
  start(actor: CommandActor, id: string, input: ProcessingVersionInput) {
    return commandTransaction(this.db, async (tx) => {
      const run = await this.lockRun(tx, actor, id, input.version, ['DRAFT']);
      if (!run.productId) throw new ConflictException('Lệnh nháp cũ không theo vòng đời mới; hủy và lập lệnh mới');
      await this.requireProcessor(tx, run.organizationId);
      await activeSite(tx, run.organizationId, run.siteId);
      await this.checkMaterials(
        tx,
        run,
        {
          inputs: run.inputs.map((i) => ({ lotId: i.lotId, quantity: i.quantity.toFixed(3) })),
          externalInputs: run.externalInputs.map((i) => ({ receiptId: i.receiptId, quantity: i.quantity.toFixed(3) })),
        },
      );
      await this.reserve(tx, run, run.inputs, run.externalInputs);
      await tx.processingRun.update({
        where: { id },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), startedBy: actor.sub!, version: { increment: 1 } },
      });
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE })) };
    });
  }

  /** Bổ sung nguyên liệu while planning or running (reserved at once when running). */
  addInputs(actor: CommandActor, id: string, input: AddProcessingInputsInput) {
    return commandTransaction(this.db, async (tx) => {
      const run = await this.lockRun(tx, actor, id, input.version, ['DRAFT', 'IN_PROGRESS']);
      if (!run.productId) throw new ConflictException('Lệnh nháp cũ không bổ sung được nguyên liệu');
      if (!input.inputs.length && !input.externalInputs.length)
        throw new UnprocessableEntityException('Chọn ít nhất một nguyên liệu');
      const { originCycles, bindings } = await this.checkMaterials(tx, run, input, {
        lotIds: run.inputs.map((i) => i.lotId),
        receiptIds: run.externalInputs.map((i) => i.receiptId),
      });
      await this.assertOneBinding(tx, [...originCycles, ...(run.originCycleId ? [run.originCycleId] : [])], [...bindings, run.bindingDigest]);
      const lotLines = input.inputs.map((i) => ({ runId: run.id, lotId: i.lotId, quantity: quantity(i.quantity), unit: run.baseUnit }));
      const externalLines = input.externalInputs.map((i) => ({ runId: run.id, receiptId: i.receiptId, quantity: quantity(i.quantity), unit: run.baseUnit }));
      if (lotLines.length) await tx.processingInput.createMany({ data: lotLines });
      if (externalLines.length) await tx.processingExternalInput.createMany({ data: externalLines });
      if (run.status === 'IN_PROGRESS') await this.reserve(tx, run, lotLines, externalLines);
      await tx.processingRun.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(!run.originCycleId && originCycles.length ? { originCycleId: [...originCycles].sort()[0] } : {}),
        },
      });
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE })) };
    });
  }

  /** Nhật ký: append-only; a mistake is corrected by a CORRECTION entry. */
  addLog(actor: CommandActor, id: string, input: ProcessingLogInput) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM processing_run WHERE id=${id}::uuid FOR SHARE`;
      const run = await tx.processingRun.findUnique({ where: { id } });
      if (!run || run.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy lệnh chế biến');
      await enterpriseAuthority(tx, actor, 'processing.write', run.chainId, run.siteId, true);
      if (run.status !== 'IN_PROGRESS') throw new ConflictException('Chỉ ghi nhật ký khi lệnh đang chế biến');
      const occurredAt = new Date(input.occurredAt);
      if (occurredAt.getTime() > Date.now() + 5 * 60_000 || occurredAt < run.createdAt)
        throw new UnprocessableEntityException('Thời điểm thực hiện phải trong khoảng từ lúc lập lệnh tới hiện tại');
      if ((input.step === 'CORRECTION') !== !!input.correctsId)
        throw new UnprocessableEntityException('Dòng đính chính phải chọn dòng nhật ký được đính chính');
      if (input.correctsId && !(await tx.processingLog.findFirst({ where: { id: input.correctsId, runId: id } })))
        throw new NotFoundException('Không tìm thấy dòng nhật ký được đính chính');
      const row = await tx.processingLog.create({
        data: { runId: id, step: input.step, occurredAt, note: input.note, correctsId: input.correctsId ?? null, recordedBy: actor.sub! },
      });
      return { record: logView(row) };
    });
  }

  private async requireStock(tx: Tx, lotId: string, organizationId: string, siteId: string, qty: Prisma.Decimal) {
    const holding = await tx.lotHolding.findUnique({ where: { lotId_organizationId: { lotId, organizationId } } });
    const stock = await tx.lotSiteHolding.findUnique({ where: { lotId_organizationId_siteId: { lotId, organizationId, siteId } } });
    if (!holding || holding.quantity.sub(holding.reserved).lt(qty) || !stock || stock.quantity.sub(stock.reserved).sub(stock.quarantined).lt(qty))
      throw new ConflictException('Cơ sở chế biến không giữ đủ lượng nguyên liệu khả dụng (đã trừ phần giữ chỗ và cách ly)');
  }

  /** Ra lò: records the main product, by-products and losses, consumes the
   * reserved materials, creates every output lot with its QR and holdings and
   * the hashed events (with the external sources and the log), then closes the
   * run — all in one transaction. */
  complete(actor: CommandActor, id: string, input: CompleteProcessingInput) {
    return commandTransaction(this.db, async (tx) => {
      const run = await this.lockRun(tx, actor, id, input.version, ['IN_PROGRESS']);
      await this.requireProcessor(tx, run.organizationId);
      const site = await activeSite(tx, run.organizationId, run.siteId);
      if (input.byProducts.some((o) => o.kind !== 'BY_PRODUCT'))
        throw new UnprocessableEntityException('Dòng phụ phẩm phải có kind = BY_PRODUCT');
      const lines = [
        { ...input.output, productId: run.productId!, kind: 'PRODUCT' },
        ...input.byProducts,
      ];
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((o) => o.productId) }, organizationId: run.organizationId, status: 'ACTIVE' },
      });
      const conversions = await tx.productUnitConversion.findMany({
        where: { productId: { in: products.map((p) => p.id) }, revokedAt: null },
      });
      const bases: Prisma.Decimal[] = [];
      for (const output of lines) {
        const product = products.find((p) => p.id === output.productId);
        if (!product)
          throw new UnprocessableEntityException('Sản phẩm và phụ phẩm phải là sản phẩm đang hoạt động của doanh nghiệp');
        bases.push(outputBaseQuantity({ productId: output.productId, quantity: quantity(output.quantity), unit: output.unit }, run.baseUnit, conversions, product.productName));
        if (output.expiryDate && output.expiryDate <= today().toISOString().slice(0, 10))
          throw new UnprocessableEntityException('Hạn sử dụng thành phẩm phải sau ngày chế biến');
      }
      const totals = await massBalance(
        tx,
        [...run.inputs.map((i) => i.quantity), ...run.externalInputs.map((i) => i.quantity)],
        bases,
        input.losses.map((l) => quantity(l.quantity)),
      );
      await tx.processingOutput.createMany({
        data: lines.map((o, index) => ({
          runId: run.id,
          productId: o.productId,
          kind: o.kind,
          quantity: quantity(o.quantity),
          unit: o.unit,
          baseQuantity: bases[index],
          lotName: o.lotName || null,
          grade: o.grade || null,
          packaging: o.packaging || null,
          packageCount: o.packageCount ?? null,
          expiryDate: o.expiryDate ? new Date(o.expiryDate + 'T00:00:00Z') : null,
        })),
      });
      if (input.losses.length)
        await tx.processingLoss.createMany({
          data: input.losses.map((l) => ({ runId: run.id, reason: l.reason, quantity: quantity(l.quantity), note: l.note || null })),
        });
      const consumed: Array<{ lotId: string; lotCode: string; quantity: string; unit: string; eventId: string }> = [];
      for (const line of [...run.inputs].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
        await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${line.lotId}::uuid FOR UPDATE`;
        const lot = await tx.lot.findUniqueOrThrow({ where: { id: line.lotId } });
        if (BLOCKED_STATES.includes(lot.currentState) || isPastExpiry(lot.expiryDate) ||
            (await tx.traceNotice.findFirst({ where: { lotId: lot.id, kind: 'RECALL' } })))
          throw new ConflictException(`Lô ${lot.lotCode} đã hết hạn, bị thu hồi hoặc không còn dùng được`);
        if (!(await quantityIsReconciled(tx, lot)))
          throw new ConflictException(`Lô ${lot.lotCode} cần đối soát số lượng trước khi chế biến`);
        const after = lot.availableQuantity.sub(line.quantity);
        if (after.isNegative()) throw new ConflictException(`Lô ${lot.lotCode} không còn đủ lượng`);
        const event = await this.trace.createInTransaction(tx, {
          entityType: 'LOT',
          entityId: lot.id,
          lotId: lot.id,
          eventType: 'DISTRIBUTION_QUANTITY_RECORDED',
          actor,
          businessData: {
            kind: 'PROCESSING_INPUT',
            runId: run.id,
            runCode: run.code,
            quantity: line.quantity.toFixed(3),
            unit: lot.unit,
            before: lot.availableQuantity.toFixed(3),
            after: after.toFixed(3),
            organizationId: run.organizationId,
            siteId: run.siteId,
          },
        });
        // The reserved share is what this run consumes.
        await tx.lotHolding.update({
          where: { lotId_organizationId: { lotId: lot.id, organizationId: run.organizationId } },
          data: { quantity: { decrement: line.quantity }, reserved: { decrement: line.quantity }, version: { increment: 1 } },
        });
        await tx.lotSiteHolding.update({
          where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: run.organizationId, siteId: run.siteId } },
          data: { quantity: { decrement: line.quantity }, reserved: { decrement: line.quantity }, version: { increment: 1 } },
        });
        await tx.lot.update({
          where: { id: lot.id },
          data: { availableQuantity: after, version: { increment: 1 }, ...(after.isZero() ? { currentState: 'CONSUMED' } : {}) },
        });
        await tx.quantityMovement.create({
          data: { lotId: lot.id, eventId: event.id, type: 'PROCESSING_OUT', quantity: line.quantity, unit: lot.unit, beforeQty: lot.availableQuantity, delta: line.quantity.negated(), afterQty: after },
        });
        consumed.push({ lotId: lot.id, lotCode: lot.lotCode, quantity: line.quantity.toFixed(3), unit: lot.unit, eventId: event.id });
      }
      const external: Array<{ receiptCode: string; materialName: string; supplierName: string; documentNo: string | null; quantity: string; unit: string; selfDeclared: true }> = [];
      for (const line of [...run.externalInputs].sort((a, b) => a.receiptId.localeCompare(b.receiptId))) {
        await tx.$queryRaw`SELECT id FROM material_receipt WHERE id=${line.receiptId}::uuid FOR UPDATE`;
        const receipt = await tx.materialReceipt.update({
          where: { id: line.receiptId },
          data: { reserved: { decrement: line.quantity }, consumed: { increment: line.quantity }, version: { increment: 1 } },
        });
        external.push({ receiptCode: receipt.code, materialName: receipt.materialName, supplierName: receipt.supplierName, documentNo: receipt.documentNo, quantity: line.quantity.toFixed(3), unit: line.unit, selfDeclared: true });
      }
      // The log goes on the ledger with the output: step, time and a digest of
      // the note (the text itself stays in the database).
      const steps = run.logs.map((l) => ({
        id: l.id,
        step: l.step,
        occurredAt: l.occurredAt.toISOString(),
        noteDigest: createHash('sha256').update(l.note).digest('hex'),
        correctsId: l.correctsId,
      }));
      const outputs = await tx.processingOutput.findMany({ where: { runId: run.id }, orderBy: { kind: 'desc' } });
      for (const output of outputs) {
        const lotCode = code('LOT-PR');
        const lot = await tx.lot.create({
          data: {
            lotCode,
            lotName: output.lotName,
            productId: output.productId,
            farmOrgId: run.organizationId,
            initialQuantity: output.quantity,
            availableQuantity: output.quantity,
            unit: output.unit,
            grade: output.grade,
            expiryDate: output.expiryDate,
            packageCount: output.packageCount,
            packaging: output.packaging,
            packedAt: today(),
            initialStorageSiteId: site.id,
            originType: 'TRANSFORMATION',
            processingRunId: run.id,
          },
        });
        await tx.processingOutput.update({ where: { id: output.id }, data: { lotId: lot.id } });
        await tx.lotHolding.create({ data: { lotId: lot.id, organizationId: run.organizationId, quantity: output.quantity } });
        await tx.lotSiteHolding.create({ data: { lotId: lot.id, organizationId: run.organizationId, siteId: site.id, quantity: output.quantity } });
        const event = await this.trace.createInTransaction(tx, {
          entityType: 'LOT',
          entityId: lot.id,
          lotId: lot.id,
          eventType: 'DISTRIBUTION_QUANTITY_RECORDED',
          actor,
          businessData: {
            kind: 'PROCESSING_OUTPUT',
            outputKind: output.kind,
            runId: run.id,
            runCode: run.code,
            processType: run.processType,
            lotCode,
            productId: output.productId,
            quantity: output.quantity.toFixed(3),
            unit: output.unit,
            baseQuantity: output.baseQuantity.toFixed(3),
            baseUnit: run.baseUnit,
            before: '0.000',
            after: output.quantity.toFixed(3),
            organizationId: run.organizationId,
            siteId: site.id,
            expiryDate: output.expiryDate?.toISOString().slice(0, 10) ?? null,
            inputs: consumed,
            externalInputs: external,
            steps,
            inputTotal: totals.input.toFixed(3),
            lossTotal: totals.loss.toFixed(3),
          },
        });
        await tx.quantityMovement.create({
          data: { lotId: lot.id, eventId: event.id, type: 'PROCESSING_IN', quantity: output.quantity, unit: output.unit, beforeQty: 0, delta: output.quantity, afterQty: output.quantity },
        });
        const traceToken = randomBytes(24).toString('base64url');
        await tx.traceQr.create({
          data: {
            lotId: lot.id,
            traceToken,
            traceUrl: `${process.env.PUBLIC_TRACE_BASE_URL ?? 'http://localhost:3000/trace'}/${traceToken}`,
          },
        });
      }
      await tx.processingRun.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedBy: actor.sub,
          inputTotal: totals.input,
          outputTotal: totals.output,
          lossTotal: totals.loss,
          variancePercent: totals.variancePercent,
          version: { increment: 1 },
        },
      });
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE })) };
    });
  }

  /** Hủy a planned or running run; a running one gives its reservations back. */
  cancel(actor: CommandActor, id: string, input: CancelProcessingInput) {
    return commandTransaction(this.db, async (tx) => {
      const run = await this.lockRun(tx, actor, id, input.version, ['DRAFT', 'IN_PROGRESS']);
      if (run.status === 'IN_PROGRESS') await this.release(tx, run, run.inputs, run.externalInputs);
      await tx.processingRun.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason, version: { increment: 1 } },
      });
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE })) };
    });
  }

  async receipts(actor: CommandActor, query: MaterialReceiptQuery) {
    const auth = await enterpriseAuthority(this.db, actor, 'processing.read');
    const rows = await this.db.materialReceipt.findMany({
      where: {
        organizationId: actor.organizationId!,
        ...(query.source ? { source: query.source } : {}),
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(auth.primary ? {} : { siteId: { in: auth.matching.flatMap((r) => r.siteIds) } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const evidence = await this.db.traceEvidence.groupBy({
      by: ['entityId'],
      where: { entityType: 'MATERIAL_RECEIPT', entityId: { in: rows.map((r) => r.id) }, withdrawal: { is: null } },
      _count: { _all: true },
    });
    const sites = await this.db.enterpriseSite.findMany({ where: { id: { in: rows.map((r) => r.siteId) } }, select: { id: true, name: true } });
    return {
      items: rows.map((r) => receiptView(r, sites.find((s) => s.id === r.siteId)?.name ?? null, evidence.some((e) => e.entityId === r.id))),
    };
  }

  async receipt(actor: CommandActor, id: string) {
    const row = await this.db.materialReceipt.findFirst({ where: { id, organizationId: actor.organizationId! } });
    if (!row) throw new NotFoundException('Không tìm thấy phiếu nhập');
    await enterpriseAuthority(this.db, actor, 'processing.read', undefined, row.siteId);
    const site = await this.db.enterpriseSite.findUnique({ where: { id: row.siteId }, select: { name: true } });
    const uses = await this.db.processingExternalInput.findMany({
      where: { receiptId: id },
      include: { run: { select: { id: true, code: true, status: true } } },
    });
    return {
      record: {
        ...receiptView(row, site?.name ?? null, await this.receiptHasEvidence(this.db as unknown as Tx, id)),
        uses: uses.map((u) => ({ runId: u.run.id, runCode: u.run.code, status: u.run.status, quantity: u.quantity.toFixed(3) })),
      },
    };
  }

  /** Phiếu nhập nguyên liệu ngoài: self-declared material with its document. */
  createReceipt(actor: CommandActor, input: CreateMaterialReceiptInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'processing.write', undefined, input.siteId, true);
      await this.requireProcessor(tx, actor.organizationId!);
      const site = await activeSite(tx, actor.organizationId!, input.siteId);
      if (!['PROCESSING', 'PACKING'].includes(site.kind))
        throw new UnprocessableEntityException('Chọn cơ sở loại chế biến hoặc đóng gói');
      const receivedAt = new Date(input.receivedAt);
      if (receivedAt.getTime() > Date.now() + 5 * 60_000)
        throw new UnprocessableEntityException('Ngày nhập không được ở tương lai');
      const row = await tx.materialReceipt.create({
        data: {
          code: code('PN'),
          organizationId: actor.organizationId!,
          siteId: site.id,
          source: 'EXTERNAL',
          materialName: input.materialName,
          supplierName: input.supplierName,
          documentNo: input.documentNo,
          receivedAt,
          quantity: quantity(input.quantity),
          unit: input.unit,
          expiryDate: input.expiryDate ? new Date(input.expiryDate + 'T00:00:00Z') : null,
          note: input.note || null,
          createdBy: actor.sub!,
        },
      });
      return { record: receiptView(row, site.name, false) };
    });
  }

  /** Tồn kho theo cơ sở chế biến: materials (AgriTrace lots and external
   * receipts) and the finished goods this organization produced. */
  async stock(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'processing.read');
    const lots = (await this.materials(actor)).items;
    const finishedIds = new Set(
      (await this.db.lot.findMany({
        where: { id: { in: lots.map((l) => l.lotId) }, processingRun: { organizationId: actor.organizationId! } },
        select: { id: true },
      })).map((l) => l.id),
    );
    const external = await this.db.materialReceipt.findMany({
      where: {
        organizationId: actor.organizationId!,
        source: 'EXTERNAL',
        ...(auth.primary ? {} : { siteId: { in: auth.matching.flatMap((r) => r.siteIds) } }),
      },
      orderBy: { receivedAt: 'desc' },
    });
    const sites = await this.db.enterpriseSite.findMany({ where: { id: { in: external.map((r) => r.siteId) } }, select: { id: true, name: true } });
    return {
      materials: [
        ...lots.filter((l) => !finishedIds.has(l.lotId)).map((l) => ({ ...l, source: 'AGRITRACE' as const })),
        ...external
          .filter((r) => receiptAvailable(r).gt(0) || r.reserved.gt(0))
          .map((r) => ({
            receiptId: r.id,
            receiptCode: r.code,
            source: 'EXTERNAL' as const,
            productName: r.materialName,
            sourceOrganization: r.supplierName,
            siteId: r.siteId,
            siteName: sites.find((s) => s.id === r.siteId)?.name ?? null,
            available: receiptAvailable(r).toFixed(3),
            reserved: r.reserved.toFixed(3),
            unit: r.unit,
            expiryDate: r.expiryDate?.toISOString().slice(0, 10) ?? null,
            blocked: isPastExpiry(r.expiryDate),
          })),
      ],
      products: lots.filter((l) => finishedIds.has(l.lotId)),
    };
  }
  async conversions(actor: CommandActor, productId?: string) {
    await enterpriseAuthority(this.db, actor, 'catalog.read');
    const rows = await this.db.productUnitConversion.findMany({
      where: { product: { organizationId: actor.organizationId! }, ...(productId ? { productId } : {}) },
      include: { product: { select: { productName: true } } },
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 500,
    });
    return { items: rows.map(conversionView) };
  }

  /** Declare how many base units one recorded unit of a product stands for.
   * A factor is never edited: revoke it and declare a new one. */
  createConversion(actor: CommandActor, input: CreateUnitConversionInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'catalog.manage', undefined, undefined, true);
      await tx.$queryRaw`SELECT product_id FROM product WHERE product_id=${input.productId}::uuid FOR UPDATE`;
      const product = await tx.product.findFirst({
        where: { id: input.productId, organizationId: actor.organizationId!, status: 'ACTIVE' },
      });
      if (!product) throw new NotFoundException('Không tìm thấy sản phẩm đang hoạt động của doanh nghiệp');
      if (sameUnit(input.unit, input.baseUnit))
        throw new UnprocessableEntityException('Đơn vị ghi nhận phải khác đơn vị cơ sở');
      const factor = new Prisma.Decimal(input.factor);
      if (!factor.gt(0)) throw new UnprocessableEntityException('Hệ số quy đổi phải lớn hơn 0');
      const existing = await tx.productUnitConversion.findMany({
        where: { productId: product.id, revokedAt: null },
      });
      if (existing.some((c) => sameUnit(c.unit, input.unit) && sameUnit(c.baseUnit, input.baseUnit)))
        throw new ConflictException('Sản phẩm đã có hệ số cho cặp đơn vị này; thu hồi hệ số cũ trước khi khai hệ số mới');
      const row = await tx.productUnitConversion.create({
        data: {
          productId: product.id,
          unit: input.unit,
          baseUnit: input.baseUnit,
          factor,
          note: input.note || null,
          createdBy: actor.sub!,
        },
        include: { product: { select: { productName: true } } },
      });
      return { record: conversionView(row) };
    });
  }

  /** Draft runs that relied on the factor can no longer complete. */
  revokeConversion(actor: CommandActor, id: string, input: RevokeUnitConversionInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'catalog.manage', undefined, undefined, true);
      await tx.$queryRaw`SELECT id FROM product_unit_conversion WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.productUnitConversion.findFirst({
        where: { id, product: { organizationId: actor.organizationId! } },
      });
      if (!row) throw new NotFoundException('Không tìm thấy hệ số quy đổi');
      if (row.revokedAt) throw new ConflictException('Hệ số quy đổi đã được thu hồi');
      const updated = await tx.productUnitConversion.update({
        where: { id },
        data: { revokedAt: new Date(), revokedBy: actor.sub!, revokeReason: input.reason },
        include: { product: { select: { productName: true } } },
      });
      return { record: conversionView(updated) };
    });
  }
}
