import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { assertRegistrationUploadProof } from './registration-otp.service.js';
import { DOCUMENT_KINDS } from './registration-profile.dto.js';
import { EnterpriseOnboardingGuard } from './enterprise-onboarding.guard.js';
import { Throttle } from '@nestjs/throttler';
import {
  RegistrationDocumentUploadDto,
  RegistrationDocumentViewDto,
  RegistrationDocumentContentDto,
  registrationDocumentSelect,
} from './registration-document.dto.js';

type Upload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};
function inspect(file: Upload | undefined, kind: string) {
  if (
    !file?.buffer.length ||
    file.size !== file.buffer.length ||
    file.size > (kind === 'LOGO' ? 2097152 : 5242880)
  )
    throw new BadRequestException(
      'Chọn tài liệu tối đa 5 MB; logo tối đa 2 MB',
    );
  const b = file.buffer;
  const mediaType =
    b.subarray(0, 5).toString() === '%PDF-'
      ? 'application/pdf'
      : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : b[0] === 255 && b[1] === 216 && b[2] === 255
          ? 'image/jpeg'
          : b.subarray(0, 4).toString() === 'RIFF' &&
              b.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : null;
  const fileName = file.originalname
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 180);
  const extension = fileName.split('.').pop()?.toLowerCase();
  const expected =
    mediaType === 'application/pdf'
      ? ['pdf']
      : mediaType === 'image/png'
        ? ['png']
        : mediaType === 'image/jpeg'
          ? ['jpg', 'jpeg']
          : ['webp'];
  if (
    !mediaType ||
    !fileName ||
    !extension ||
    !expected.includes(extension) ||
    (kind === 'LOGO' && mediaType === 'application/pdf') ||
    (kind !== 'LOGO' && mediaType === 'image/webp')
  )
    throw new BadRequestException(
      'Tài liệu nhận PDF/JPG/PNG; logo nhận JPG/PNG/WebP. Nội dung phải đúng định dạng file',
    );
  return {
    fileName,
    mediaType,
    size: file.size,
    sha256: createHash('sha256').update(b).digest('hex'),
  };
}
@ApiTags('enterprise-onboarding')
@Controller('auth/registration-documents')
@UseGuards(EnterpriseOnboardingGuard)
export class RegistrationDocumentUploadController {
  constructor(private readonly db: PrismaService) {}
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'id',
        'registrationId',
        'verificationId',
        'token',
        'kind',
        'file',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        registrationId: { type: 'string', format: 'uuid' },
        verificationId: { type: 'string', format: 'uuid' },
        token: { type: 'string', writeOnly: true },
        kind: { type: 'string', enum: [...DOCUMENT_KINDS] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiDataResponse(RegistrationDocumentViewDto, 201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5242880, files: 1, fields: 5, fieldSize: 2000 },
    }),
  )
  async upload(
    @Body() input: RegistrationDocumentUploadDto,
    @UploadedFile() file: Upload | undefined,
  ) {
    const metadata = inspect(file, input.kind);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`registration-documents:${input.registrationId}`},0))`;
      const proof = await assertRegistrationUploadProof(
        tx,
        input.registrationId,
        input,
      );
      const old = await tx.enterpriseRegistrationDocument.findUnique({
        where: { id: input.id },
      });
      if (old) {
        const owner = await tx.registrationEmailVerification.findUnique({
          where: { id: old.verificationId },
          select: { email: true },
        });
        if (
          old.registrationId !== input.registrationId ||
          old.kind !== input.kind ||
          old.sha256 !== metadata.sha256 ||
          old.fileName !== metadata.fileName ||
          old.organizationId ||
          owner?.email !== proof.email
        )
          throw new BadRequestException(
            'Mã tài liệu đã được dùng cho nội dung khác',
          );
        return Object.fromEntries(
          Object.keys(registrationDocumentSelect).map((key) => [
            key,
            old[key as keyof typeof old],
          ]),
        );
      }
      if (
        (await tx.enterpriseRegistrationDocument.count({
          where: { registrationId: input.registrationId },
        })) >= 8
      )
        throw new BadRequestException(
          'Mỗi hồ sơ tối đa 8 tài liệu; giữ các file đã tải để gửi hồ sơ',
        );
      return tx.enterpriseRegistrationDocument.create({
        data: {
          id: input.id,
          registrationId: input.registrationId,
          verificationId: proof.id,
          kind: input.kind,
          ...metadata,
          content: Uint8Array.from(file!.buffer),
        },
        select: registrationDocumentSelect,
      });
    });
  }
}
@ApiTags('enterprise-onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise-registration-documents')
export class RegistrationDocumentReadController {
  constructor(private readonly db: PrismaService) {}
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiDataResponse(RegistrationDocumentContentDto)
  async read(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const row = await this.db.enterpriseRegistrationDocument.findUnique({
      where: { id },
    });
    if (!row?.organizationId)
      throw new NotFoundException('Không tìm thấy tài liệu');
    if (req.user.role !== 'SYSTEM_ADMIN') {
      const owner = await this.db.enterpriseEnrollment.findUnique({
        where: { id: row.registrationId },
        select: { ownerId: true, organizationId: true },
      });
      if (
        owner?.ownerId !== req.user.sub ||
        owner.organizationId !== req.user.organizationId
      )
        throw new NotFoundException('Không tìm thấy tài liệu');
    }
    return {
      ...Object.fromEntries(
        Object.keys(registrationDocumentSelect).map((key) => [
          key,
          row[key as keyof typeof row],
        ]),
      ),
      contentBase64: Buffer.from(row.content).toString('base64'),
    };
  }
}
