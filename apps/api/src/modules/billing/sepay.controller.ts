import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiDataResponse } from '../../common/api/openapi.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  authenticateSepay,
  parseSepayTransaction,
  sepayConfiguration,
} from './sepay-protocol.js';
import {
  SepayCheckoutView,
  SepayWebhookAcknowledgement,
  SepayWebhookInput,
  SepayIpnInput,
} from './sepay.dto.js';
import {
  authenticateSepayIpn,
  parseSepayIpn,
  sepayGatewayConfiguration,
} from './sepay-gateway.js';
import { SepayService } from './sepay.service.js';

@ApiTags('sepay-payments')
@Controller()
export class SepayController {
  constructor(private readonly service: SepayService) {}

  @Post('payments/sepay/ipn/:mode')
  @ApiHeader({
    name: 'X-Secret-Key',
    required: true,
    description:
      'Separate server-only SEPAY_IPN_SECRET configured in Gateway IPN settings',
  })
  @ApiBody({ type: SepayIpnInput })
  @ApiResponse({
    status: 200,
    type: SepayWebhookAcknowledgement,
    description: 'Acknowledged only after settlement/receipt commits',
  })
  async ipn(
    @Param('mode') mode: string,
    @Headers('x-secret-key') key: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const config = sepayGatewayConfiguration();
    if (!config || config.mode !== mode)
      throw new NotFoundException('SePay IPN chưa được bật');
    authenticateSepayIpn(key, config);
    await this.service.receiveSettlement(config, parseSepayIpn(body));
    response.status(200).json({ success: true });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise-service/payment/sepay')
  @ApiDataResponse(SepayCheckoutView)
  checkout(@Req() req: AuthenticatedRequest) {
    return this.service.checkout(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise-billing/invoices/:id/sepay')
  @ApiDataResponse(SepayCheckoutView)
  invoice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.checkout(req.user, id);
  }

  @Post('payments/sepay/webhook/:mode')
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description:
      'Apikey <SEPAY_WEBHOOK_KEY>; server-to-server only, never a user bearer token',
  })
  @ApiBody({ type: SepayWebhookInput })
  @ApiResponse({
    status: 200,
    type: SepayWebhookAcknowledgement,
    description:
      'Exact SePay acknowledgement; only after the receipt transaction commits',
  })
  async webhook(
    @Param('mode') mode: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    if (sepayGatewayConfiguration())
      throw new NotFoundException('Đang sử dụng SePay Gateway IPN');
    const config = sepayConfiguration();
    if (!config || config.mode !== mode)
      throw new NotFoundException('SePay webhook chưa được bật');
    authenticateSepay(authorization, config);
    await this.service.receive(config, parseSepayTransaction(body));
    // The provider requires this body, not AgriTrace's normal data envelope.
    response.status(200).json({ success: true });
  }
}
