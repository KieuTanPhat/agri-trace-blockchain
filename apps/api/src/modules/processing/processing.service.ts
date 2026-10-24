import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
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
import { downstreamLots, upstreamLots } from './processing-lineage.js';
import type {
  CancelProcessingInput,
  CreateProcessingRunInput,
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

  create(actor: CommandActor, input: CreateProcessingRunInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'processing.write', input.chainId, input.siteId, true);
      const organizationId = actor.organizationId!;
      if (!(await tx.organizationCapability.findFirst({ where: { organizationId, code: 'PROCESSOR', revokedAt: null } })))
        throw new ForbiddenException('Tổ chức chưa được duyệt năng lực chế biến');
      const site = await activeSite(tx, organizationId, input.siteId);
      if (!['PROCESSING', 'PACKING'].includes(site.kind))
        throw new UnprocessableEntityException('Chọn cơ sở loại chế biến hoặc đóng gói');
      const lotIds = input.inputs.map((i) => i.lotId);
      if (new Set(lotIds).size !== lotIds.length)
        throw new UnprocessableEntityException('Mỗi lô nguyên liệu chỉ khai báo một lần');
      const lots = await tx.lot.findMany({
        where: { id: { in: lotIds } },
        include: { harvest: { include: { cycle: true } }, processingRun: true },
      });
      const originCycles: string[] = [];
      for (const line of input.inputs) {
        const lot = lots.find((l) => l.id === line.lotId);
        if (!lot) throw new NotFoundException('Không tìm thấy lô nguyên liệu');
        if (lotChainId(lot) !== input.chainId)
          throw new UnprocessableEntityException(`Lô ${lot.lotCode} không thuộc chuỗi của lệnh`);
        if (lot.unit !== input.baseUnit)
          throw new UnprocessableEntityException(`Lô ${lot.lotCode} dùng đơn vị ${lot.unit}, khác đơn vị cơ sở ${input.baseUnit}`);
        if (BLOCKED_STATES.includes(lot.currentState) || isPastExpiry(lot.expiryDate))
          throw new ConflictException(`Lô ${lot.lotCode} đã hết hạn, bị thu hồi hoặc không còn dùng được`);
        await this.requireStock(tx, lot.id, organizationId, input.siteId, quantity(line.quantity));
        const origin = lot.harvest?.cycleId ?? lot.processingRun?.originCycleId;
        if (!origin) throw new ConflictException(`Lô ${lot.lotCode} chưa xác định được vụ gốc`);
        originCycles.push(origin);
      }
      // Processed events stay on the binding of their inputs' origin; inputs
      // from different ledger bindings cannot be mixed in one run.
      const contexts = await tx.cycleLedgerContext.findMany({ where: { cycleId: { in: originCycles } } });
      const digests = new Set(contexts.map((c) => c.bindingDigest));
      if (digests.size > 1 || (contexts.length > 0 && new Set(originCycles).size !== new Set(contexts.map((c) => c.cycleId)).size))
        throw new ConflictException('Các lô nguyên liệu ghi trên các binding sổ cái khác nhau; tách thành nhiều lệnh');
      const products = await tx.product.findMany({
        where: { id: { in: input.outputs.map((o) => o.productId) }, organizationId, status: 'ACTIVE' },
      });
      const conversions = await tx.productUnitConversion.findMany({
        where: { productId: { in: products.map((p) => p.id) }, revokedAt: null },
      });
      const bases: Prisma.Decimal[] = [];
      for (const output of input.outputs) {
        const product = products.find((p) => p.id === output.productId);
        if (!product)
          throw new UnprocessableEntityException('Sản phẩm thành phẩm phải là sản phẩm đang hoạt động của doanh nghiệp');
        const base = outputBaseQuantity(
          { productId: output.productId, quantity: quantity(output.quantity), unit: output.unit },
          input.baseUnit,
          conversions,
          product.productName,
        );
        if (output.baseQuantity !== undefined && !quantity(output.baseQuantity).equals(base))
          throw new UnprocessableEntityException(
            `Lượng quy đổi của ${product.productName} phải là ${base.toFixed(3)} ${input.baseUnit} theo hệ số đã khai`,
          );
        bases.push(base);
        if (output.expiryDate && output.expiryDate <= today().toISOString().slice(0, 10))
          throw new UnprocessableEntityException('Hạn sử dụng thành phẩm phải sau ngày chế biến');
      }
      if (!input.outputs.some((o) => o.kind === 'PRODUCT'))
        throw new UnprocessableEntityException('Lệnh chế biến cần ít nhất một thành phẩm chính');
      await massBalance(
        tx,
        input.inputs.map((i) => quantity(i.quantity)),
        bases,
        input.losses.map((l) => quantity(l.quantity)),
      );
      const run = await tx.processingRun.create({
        data: {
          code: code('PR'),
          organizationId,
          chainId: input.chainId,
          siteId: input.siteId,
          processType: input.processType,
          baseUnit: input.baseUnit,
          recipe: input.recipe || null,
          note: input.note || null,
          originCycleId: [...originCycles].sort()[0],
          createdBy: actor.sub!,
        },
      });
      await tx.processingInput.createMany({
        data: input.inputs.map((i) => ({ runId: run.id, lotId: i.lotId, quantity: quantity(i.quantity), unit: input.baseUnit })),
      });
      await tx.processingOutput.createMany({
        data: input.outputs.map((o, index) => ({
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
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE })) };
    });
  }

  private async requireStock(tx: Tx, lotId: string, organizationId: string, siteId: string, qty: Prisma.Decimal) {
    const holding = await tx.lotHolding.findUnique({ where: { lotId_organizationId: { lotId, organizationId } } });
    const stock = await tx.lotSiteHolding.findUnique({ where: { lotId_organizationId_siteId: { lotId, organizationId, siteId } } });
    if (!holding || holding.quantity.sub(holding.reserved).lt(qty) || !stock || stock.quantity.sub(stock.reserved).sub(stock.quarantined).lt(qty))
      throw new ConflictException('Cơ sở chế biến không giữ đủ lượng nguyên liệu khả dụng (đã trừ phần giữ chỗ và cách ly)');
  }

  /** Consumes every input, creates every output lot with its QR and holdings,
   * records the hashed events, then closes the run — all in one transaction. */
  complete(actor: CommandActor, id: string, input: ProcessingVersionInput) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM processing_run WHERE id=${id}::uuid FOR UPDATE`;
      const run = await tx.processingRun.findUnique({ where: { id }, include: { inputs: true, outputs: true, losses: true } });
      if (!run || run.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy lệnh chế biến');
      if (run.status !== 'DRAFT' || run.version !== input.version)
        throw new ConflictException('Lệnh chế biến đã được xử lý hoặc đã thay đổi');
      await enterpriseAuthority(tx, actor, 'processing.write', run.chainId, run.siteId, true);
      // A draft may outlive the capability or a product; recheck both under
      // the run lock before anything is consumed.
      if (!(await tx.organizationCapability.findFirst({ where: { organizationId: run.organizationId, code: 'PROCESSOR', revokedAt: null } })))
        throw new ForbiddenException('Tổ chức không còn năng lực chế biến');
      const activeProducts = await tx.product.count({
        where: { id: { in: [...new Set(run.outputs.map((o) => o.productId))] }, organizationId: run.organizationId, status: 'ACTIVE' },
      });
      if (activeProducts !== new Set(run.outputs.map((o) => o.productId)).size)
        throw new UnprocessableEntityException('Sản phẩm thành phẩm không còn hoạt động; hủy lệnh và lập lệnh mới');
      const activeConversions = await tx.productUnitConversion.findMany({
        where: { productId: { in: run.outputs.map((o) => o.productId) }, revokedAt: null },
      });
      for (const output of run.outputs) {
        let current: Prisma.Decimal | undefined;
        try {
          current = outputBaseQuantity(output, run.baseUnit, activeConversions);
        } catch {
          current = undefined;
        }
        if (!current?.equals(output.baseQuantity))
          throw new ConflictException('Hệ số quy đổi của thành phẩm đã bị thu hồi hoặc thay đổi; hủy lệnh và lập lệnh mới');
      }
      const site = await activeSite(tx, run.organizationId, run.siteId);
      const totals = await massBalance(
        tx,
        run.inputs.map((i) => i.quantity),
        run.outputs.map((o) => o.baseQuantity),
        run.losses.map((l) => l.quantity),
      );
      const consumed: Array<{ lotId: string; lotCode: string; quantity: string; unit: string; eventId: string }> = [];
      for (const line of [...run.inputs].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
        await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${line.lotId}::uuid FOR UPDATE`;
        const lot = await tx.lot.findUniqueOrThrow({ where: { id: line.lotId } });
        if (BLOCKED_STATES.includes(lot.currentState) || isPastExpiry(lot.expiryDate) ||
            (await tx.traceNotice.findFirst({ where: { lotId: lot.id, kind: 'RECALL' } })))
          throw new ConflictException(`Lô ${lot.lotCode} đã hết hạn, bị thu hồi hoặc không còn dùng được`);
        if (!(await quantityIsReconciled(tx, lot)))
          throw new ConflictException(`Lô ${lot.lotCode} cần đối soát số lượng trước khi chế biến`);
        await this.requireStock(tx, lot.id, run.organizationId, run.siteId, line.quantity);
        const after = lot.availableQuantity.sub(line.quantity);
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
        await tx.lotHolding.update({
          where: { lotId_organizationId: { lotId: lot.id, organizationId: run.organizationId } },
          data: { quantity: { decrement: line.quantity }, version: { increment: 1 } },
        });
        await tx.lotSiteHolding.update({
          where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: run.organizationId, siteId: run.siteId } },
          data: { quantity: { decrement: line.quantity }, version: { increment: 1 } },
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
      for (const output of run.outputs) {
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

  cancel(actor: CommandActor, id: string, input: CancelProcessingInput) {
    return commandTransaction(this.db, async (tx) => {
      const run = await tx.processingRun.findUnique({ where: { id } });
      if (!run || run.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy lệnh chế biến');
      await enterpriseAuthority(tx, actor, 'processing.write', run.chainId, run.siteId, true);
      const changed = await tx.processingRun.updateMany({
        where: { id, version: input.version, status: 'DRAFT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Lệnh chế biến đã được xử lý hoặc đã thay đổi');
      return { record: runView(await tx.processingRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE })) };
    });
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
