import {
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import {
  ConsumerController,
  MobileAuthController,
  MobileAuthGuard,
} from './mobile-auth.controller.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { FirebasePhoneVerifier } from './firebase-phone-verifier.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { OrganizationAccessService } from './organization-access.service.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_EXPIRES_IN',
            '1h',
          ) as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, MobileAuthController, ConsumerController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    OrganizationAccessService,
    MobileAuthService,
    MobileAuthGuard,
    FirebasePhoneVerifier,
  ],
  exports: [JwtAuthGuard, JwtModule, RolesGuard, OrganizationAccessService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Before guards/throttle/validation: failures must not cache credentials either.
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(MobileAuthController, ConsumerController);
  }
}
