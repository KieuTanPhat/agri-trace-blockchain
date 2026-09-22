import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from '../trace/public.js';

@Injectable()
export class BlockchainProofQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(eventId: string) {
    const event = await this.prisma.traceEvent.findUnique({
      where: { id: eventId },
      include: { blockchainProof: true, blockchainOutbox: true },
    });
    if (!event) throw new NotFoundException('Không tìm thấy trace event');

    const proof = event.blockchainProof;
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
        (!proof || proof.dataHash === event.dataHash) &&
        event.dataHash === calculateTraceEventHash(event),
      txId: proof?.txId ?? null,
      channelId:
        proof?.channelId ?? process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
      recordedAt: proof?.recordedAt ?? null,
      attemptCount: event.blockchainOutbox?.attemptCount ?? 0,
      lastError: event.blockchainOutbox?.lastError ?? null,
    };
  }
}
