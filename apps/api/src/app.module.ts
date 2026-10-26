import { CatalogModule } from './modules/catalog/catalog.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { ProcessingModule } from './modules/processing/processing.module.js';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module.js';
import { EnterpriseWorkspaceModule } from './modules/enterprise-workspace/enterprise-workspace.module.js';
import { DistributionModule } from './modules/distribution/distribution.module.js';
import { PlatformGovernanceModule } from './modules/platform-governance/platform-governance.module.js';
import { PublicDirectoryModule } from './modules/public-directory/public-directory.module.js';
import { PublicContentModule } from './modules/public-content/public-content.module.js';
import { WeatherModule } from './modules/weather/weather.module.js';
import { EnterpriseOnboardingModule } from './modules/enterprise-onboarding/enterprise-onboarding.module.js';
import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MaintenanceWriteInterceptor } from './common/maintenance/maintenance-write.interceptor.js';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestIdMiddleware } from './common/request/request-id.middleware.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { LotsModule } from './modules/lots/lots.module.js';
import { ProductionCyclesModule } from './modules/production-cycles/production-cycles.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { SigningModule } from './modules/signing/signing.module.js';
import { TraceModule } from './modules/trace/trace.module.js';
import { IotModule } from './modules/iot/iot.module.js';
import { BlockchainAdapterModule } from './modules/blockchain-adapter/blockchain-adapter.module.js';
import { HealthModule } from './health/health.module.js';
import { ComplianceModule } from './modules/compliance/compliance.module.js';
import { SupplyChainsModule } from './modules/supply-chains/supply-chains.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.OPENAPI_EXPORT === 'true',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_REQUESTS ?? 120),
      },
    ]),
    AuthModule,
    PlatformGovernanceModule,
    BillingModule,
    ProcessingModule,
    PlatformAdminModule,
    EnterpriseOnboardingModule,
    EnterpriseWorkspaceModule,
    DistributionModule,
    UsersModule,
    CatalogModule,
    PublicDirectoryModule,
    PublicContentModule,
    WeatherModule,
    OrganizationsModule,
    ProductionCyclesModule,
    LotsModule,
    ShipmentsModule,
    SigningModule,
    TraceModule,
    IotModule,
    ComplianceModule,
    SupplyChainsModule,
    BlockchainAdapterModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: MaintenanceWriteInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
