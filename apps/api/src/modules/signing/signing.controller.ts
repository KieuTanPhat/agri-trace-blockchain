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
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  RegisterSigningKeyDto,
  RevokeSigningKeyDto,
  SigningContextDto,
  SigningKeyDto,
} from './dto.js';
import { SigningKeysService } from './signing-keys.service.js';

@ApiTags('signing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SigningController {
  constructor(
    private readonly keys: SigningKeysService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('supply-chains/:chainId/signing-keys')
  @ApiDataResponse(SigningContextDto)
  context(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
  ) {
    return this.keys.context(req.user, chainId);
  }

  @Post('supply-chains/:chainId/signing-keys')
  @ApiDataResponse(SigningKeyDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  register(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() input: RegisterSigningKeyDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_REGISTER_SIGNING_KEY',
      { ...input, chainId, organizationId: req.user.organizationId },
      () => this.keys.register(req.user, chainId, input),
    );
  }

  @Post('supply-chains/:chainId/signing-keys/:keyRef/revoke')
  @ApiDataResponse(SigningKeyDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('keyRef', ParseUUIDPipe) keyRef: string,
    @Body() input: RevokeSigningKeyDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_REVOKE_SIGNING_KEY',
      { ...input, chainId, keyRef, organizationId: req.user.organizationId },
      () => this.keys.revoke(req.user, chainId, keyRef, input.reason),
    );
  }

  private command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload,
      },
      work,
    );
  }
}
