import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { privateTraceEvidenceMatches } from '../trace/trace-evidence.js';
import { harvestSensorTraceEvidenceMatches } from '../iot/harvest-sensor-evidence.js';
import { getLotEventProofStatus } from '../lots/lot-proof-status.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { scopedTraceEventReadWhere } from '../supply-chains/business-read-scope.js';
import {
  EVENT_BINDING_CONTEXT_INCLUDE,
  EVENT_LEDGER_ROUTE_INCLUDE,
  routeProofMatches,
  verifiedEventRoute,
} from '../trace/ledger-route.js';

@Injectable()
export class BlockchainProofQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async verify(eventId: string, actor: Actor) {
    await this.access.assertTraceEventAccess(actor, eventId);
    const event = await this.prisma.traceEvent.findFirst({
      where: { AND: [{ id: eventId }, scopedTraceEventReadWhere(actor)] },
      include: {
        blockchainProof: true,
        blockchainOutbox: true,
        ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
        bindingContext: EVENT_BINDING_CONTEXT_INCLUDE,
      },
    });
    if (!event) throw new NotFoundException('Không tìm thấy trace event');

    const proof = event.blockchainProof;
    const route = verifiedEventRoute(event);
    const sensorMatches = await harvestSensorTraceEvidenceMatches(
      this.prisma,
      event,
    );
    return {
      eventId,
      status: proof
        ? proof.transactionStatus
        : event.blockchainOutbox?.status === 'DEAD_LETTER'
          ? 'FAILED'
          : 'PENDING',
      deliveryStatus: event.blockchainOutbox?.status ?? 'COMPLETED',
      dataHash: proof?.dataHash ?? event.dataHash,
      localHashMatches:
        Boolean(route) &&
        (!proof || routeProofMatches(event, proof)) &&
        privateTraceEvidenceMatches(event) &&
        sensorMatches,
      proofStatus: sensorMatches
        ? getLotEventProofStatus(event)
        : 'INTEGRITY_WARNING',
      txId: proof?.txId ?? null,
      channelId: route?.channelId ?? null,
      recordedAt: proof?.recordedAt ?? null,
      attemptCount: event.blockchainOutbox?.attemptCount ?? 0,
      lastError: event.blockchainOutbox?.lastError ?? null,
    };
  }
}
