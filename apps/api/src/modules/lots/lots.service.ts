import { Injectable } from '@nestjs/common';
import type { Actor } from '../trace/trace.service.js';
import type { RecordHarvestDto } from './dto.js';
import { RecordHarvestService } from './record-harvest.service.js';
import { LotQueryService } from './lot-query.service.js';
/** Stable public entrypoint for lot commands and read projections. */
@Injectable()
export class LotsService {
  constructor(
    private readonly harvest: RecordHarvestService,
    private readonly queries: LotQueryService,
  ) {}
  async recordHarvest(cycleId: string, input: RecordHarvestDto, actor: Actor) {
    return this.harvest.recordHarvest(cycleId, input, actor);
  }
  async getInternal(lotId: string, actor: Actor) {
    return this.queries.getInternal(lotId, actor);
  }
  async getList(actor: Actor) {
    return this.queries.getList(actor);
  }
  async getDashboard(actor: Actor) {
    return this.queries.getDashboard(actor);
  }
  async getPublic(traceToken: string) {
    return this.queries.getPublic(traceToken);
  }
}
