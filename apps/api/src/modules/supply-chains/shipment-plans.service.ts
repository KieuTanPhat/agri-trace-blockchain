import { Injectable, NotFoundException } from '@nestjs/common';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma, ShipmentPlan } from '../../generated/prisma/client.js';
import { TraceService } from '../trace/trace.service.js';
import {
  acceptShipmentPlan,
  cancelShipmentPlan,
  createShipmentPlan,
  finalizeShipmentPlan,
  reviseShipmentPlan,
  type DraftShipmentPlan,
} from './shipment-plan.commands.js';
import type { AcceptShipmentPlanDto } from './shipment-plan.dto.js';
import { authorizeBusinessCommand } from './business-policy.js';
import { trustedLegacyCycleWhere } from './legacy-scope-pins.js';

const currentSelect = {
  revision: true,
  producerOrgId: true,
  transporterOrgId: true,
  retailerOrgId: true,
  quantity: true,
  unit: true,
  origin: true,
  destination: true,
  vehicleRef: true,
  plannedPickupTime: true,
  expectedArrivalTime: true,
  payloadDigest: true,
  acceptances: {
    select: { party: true, organizationId: true, acceptedAt: true },
    orderBy: { party: 'asc' },
  },
} satisfies Prisma.ShipmentPlanRevisionSelect;

/** Plan payload is a coordination projection. Grant/user identifiers are not
 * included in HTTP responses; no raw partner metadata is read through here. */
export function shipmentPlanReadWhere(
  actor: CommandActor,
  chainId: string,
): Prisma.ShipmentPlanWhereInput {
  if (!actor.sub || !actor.organizationId || actor.role === 'SYSTEM_ADMIN')
    return { id: '00000000-0000-0000-0000-000000000000' };
  const org = actor.organizationId;
  const admin = {
    some: {
      userId: actor.sub,
      organizationId: org,
      scope: 'ORGANIZATION' as const,
      chainId: null,
      role: 'ORG_ADMIN' as const,
      revokedAt: null,
      user: { accountStatus: 'ACTIVE' as const },
    },
  };
  const participant = (code: 'FARM' | 'TRANSPORTER' | 'RETAILER') => ({
    id: org,
    status: 'ACTIVE' as const,
    capabilities: { some: { code, revokedAt: null } },
    scopedGrants: admin,
  });
  return {
    chainId,
    lot: { harvest: { cycle: trustedLegacyCycleWhere() } },
    chain: {
      is: {
        businessProfile: { is: { state: 'ACTIVE', scopeVersion: 1 } },
        memberships: { some: { organizationId: org, status: 'ACTIVE' } },
      },
    },
    OR: [
      {
        chain: {
          is: {
            ownerOrganizationId: org,
            grants: {
              some: {
                userId: actor.sub,
                organizationId: org,
                scope: 'CHAIN',
                role: 'CHAIN_MANAGER',
                revokedAt: null,
                user: { accountStatus: 'ACTIVE' },
                organization: { status: 'ACTIVE' },
              },
            },
          },
        },
      },
      {
        current: {
          is: {
            OR: [
              { producer: { is: participant('FARM') } },
              { transporter: { is: participant('TRANSPORTER') } },
              { retailer: { is: participant('RETAILER') } },
            ],
          },
        },
      },
    ],
  };
}

@Injectable()
export class ShipmentPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: TraceService,
  ) {}
  async planningLots(actor: CommandActor, chainId: string) {
    await authorizeBusinessCommand(this.prisma, actor, {
      chainId,
      role: 'CHAIN_MANAGER',
    });
    const lots = await this.prisma.lot.findMany({
      where: {
        currentState: 'HARVESTED',
        availableQuantity: { gt: 0 },
        shipment: { is: null },
        harvest: {
          cycle: {
            chainId,
            AND: [trustedLegacyCycleWhere()],
            assignments: { some: { stage: 'PRODUCTION', status: 'ACCEPTED' } },
          },
        },
        organization: {
          status: 'ACTIVE',
          capabilities: { some: { code: 'FARM', revokedAt: null } },
          chainMemberships: { some: { chainId, status: 'ACTIVE' } },
        },
      },
      select: {
        id: true,
        lotCode: true,
        availableQuantity: true,
        unit: true,
        farmOrgId: true,
        product: { select: { productName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return lots.map((lot) => ({
      id: lot.id,
      lotCode: lot.lotCode,
      quantity: lot.availableQuantity.toFixed(3),
      unit: lot.unit,
      productName: lot.product.productName,
      producerOrgId: lot.farmOrgId,
    }));
  }
  list(actor: CommandActor, chainId: string) {
    return this.prisma.shipmentPlan.findMany({
      where: shipmentPlanReadWhere(actor, chainId),
      include: { current: { select: currentSelect } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async get(actor: CommandActor, chainId: string, id: string) {
    const plan = await this.prisma.shipmentPlan.findFirst({
      where: { AND: [shipmentPlanReadWhere(actor, chainId), { id }] },
      include: { current: { select: currentSelect } },
    });
    if (!plan)
      throw new NotFoundException('Không tìm thấy kế hoạch trong chuỗi');
    return plan;
  }
  private async project(tx: Prisma.TransactionClient, id: string) {
    return tx.shipmentPlan.findUniqueOrThrow({
      where: { id },
      include: { current: { select: currentSelect } },
    });
  }
  create(
    actor: CommandActor,
    chainId: string,
    lotId: string,
    input: DraftShipmentPlan,
  ) {
    return commandTransaction(
      this.prisma,
      async (tx) => {
        const plan = await createShipmentPlan(tx, actor, chainId, lotId, input);
        return this.project(tx, plan.id);
      },
      { timeout: 20000 },
    );
  }
  revise(
    actor: CommandActor,
    id: string,
    version: number,
    input: DraftShipmentPlan,
  ) {
    return commandTransaction(
      this.prisma,
      async (tx) => {
        const plan = await reviseShipmentPlan(tx, actor, id, version, input);
        return this.project(tx, plan.id);
      },
      { timeout: 20000 },
    );
  }
  accept(actor: CommandActor, id: string, input: AcceptShipmentPlanDto) {
    return commandTransaction(
      this.prisma,
      async (tx) => {
        const accepted = await acceptShipmentPlan(
          tx,
          actor,
          id,
          input.party,
          input.revision,
          input.payloadDigest,
        );
        return {
          id: accepted.id,
          planId: accepted.planId,
          revision: accepted.revision,
          party: accepted.party,
          organizationId: accepted.organizationId,
          acceptedAt: accepted.acceptedAt,
        };
      },
      { timeout: 20000 },
    );
  }
  cancel(actor: CommandActor, id: string, version: number) {
    return commandTransaction(
      this.prisma,
      async (tx) => {
        const plan: ShipmentPlan = await cancelShipmentPlan(
          tx,
          actor,
          id,
          version,
        );
        return this.project(tx, plan.id);
      },
      { timeout: 20000 },
    );
  }
  finalize(actor: CommandActor, id: string, version: number) {
    return commandTransaction(
      this.prisma,
      async (tx) => {
        const result = await finalizeShipmentPlan(
          tx,
          actor,
          id,
          version,
          this.trace,
        );
        return {
          planId: result.planId,
          revision: result.revision,
          shipmentId: result.shipment.id,
          eventId: result.eventId,
        };
      },
      { timeout: 20000 },
    );
  }
}
