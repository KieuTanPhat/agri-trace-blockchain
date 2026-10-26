import { ApiDataResponse } from '../../common/api/openapi.js';
import { ProductionCycleRecordDto } from '../../common/api/record.dto.js';
import {
  CycleListDto,
  CycleDetailDto,
  CareResultDto,
  SensorReadingResultDto,
} from '../../common/api/response.dto.js';
import { FARM_WRITE_ROLES } from '../auth/business-write.policy.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandPolicy } from '../auth/command-policy.decorator.js';
import {
  CancelCycleDto,
  CareRecordDto,
  CreateProductionCycleDto,
  PlantCycleDto,
  SensorReadingDto,
  VersionedCommandDto,
  CreateProductionCycleDraftDto,
  LinkProductionCycleDraftDto,
  ProductionCycleDraftListDto,
  ProductionCycleDraftRecordDto,
  SetCycleStaffDto,
  CycleStaffRecordDto,
} from './dto.js';
import { ProductionCyclesService } from './production-cycles.service.js';

@ApiTags('production-cycles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FARM_WRITE_ROLES)
@Controller('production-cycles')
@CommandPolicy()
export class ProductionCyclesController {
  constructor(
    private readonly service: ProductionCyclesService,
    private readonly idempotency: IdempotencyService,
  ) {}
  private run(
    operation: string,
    key: string,
    request: AuthenticatedRequest,
    payload: unknown,
    command: () => Promise<unknown>,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        responseStatus: 201,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      command,
    );
  }

  @ApiDataResponse(CycleListDto, 200, true)
  @Get()
  @Roles(
    'SYSTEM_ADMIN',
    'FARM_STAFF',
    'TRANSPORTER',
    'DISTRIBUTOR',
    'RETAILER',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  )
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }

  @ApiDataResponse(ProductionCycleDraftListDto, 200)
  @Get('drafts')
  drafts(@Req() req: AuthenticatedRequest) {
    return this.service.drafts(req.user);
  }

  @ApiDataResponse(ProductionCycleDraftRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('drafts')
  createDraft(
    @Body() dto: CreateProductionCycleDraftDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('EW_CREATE_CYCLE_DRAFT', key, req, dto, () =>
      this.service.createDraft(dto, req.user),
    );
  }

  @ApiDataResponse(ProductionCycleRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('drafts/:id/link')
  linkDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkProductionCycleDraftDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('EW_LINK_CYCLE_DRAFT', key, req, { id, ...dto }, () =>
      this.service.linkDraft(id, dto, req.user),
    );
  }

  @ApiDataResponse(CycleDetailDto, 200)
  @Get(':id')
  @Roles(
    'SYSTEM_ADMIN',
    'FARM_STAFF',
    'TRANSPORTER',
    'DISTRIBUTOR',
    'RETAILER',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  )
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.get(id, req.user);
  }

  @ApiDataResponse(ProductionCycleRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  create(
    @Body() dto: CreateProductionCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CREATE_PRODUCTION_CYCLE', key, req, dto, () =>
      this.service.create(dto, req.user),
    );
  }
  @ApiDataResponse(ProductionCycleRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/plant')
  plant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlantCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('PLANT_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.plant(id, dto, req.user),
    );
  }
  @ApiDataResponse(CareResultDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/care')
  care(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CareRecordDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_CARE', key, req, { id, ...dto }, () =>
      this.service.addCare(id, dto, req.user),
    );
  }
  @ApiDataResponse(SensorReadingResultDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/sensor-readings')
  sensor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SensorReadingDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_SENSOR', key, req, { id, ...dto }, () =>
      this.service.addSensorReading(id, dto, req.user),
    );
  }
  @ApiDataResponse(ProductionCycleRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/close')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedCommandDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CLOSE_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.close(id, dto, req.user),
    );
  }
  @ApiDataResponse(ProductionCycleRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CANCEL_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.cancel(id, dto, req.user),
    );
  }
  @ApiDataResponse(CycleStaffRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/staff')
  setStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCycleStaffDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('EW_SET_CYCLE_STAFF', key, req, { id, ...dto }, () =>
      this.service.setStaff(id, dto, req.user),
    );
  }
}
