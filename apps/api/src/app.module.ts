import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/request/request-id.middleware.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { LotsModule } from './modules/lots/lots.module.js';
import { ProductionCyclesModule } from './modules/production-cycles/production-cycles.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { TraceModule } from './modules/trace/trace.module.js';
import { IotModule } from './modules/iot/iot.module.js';
import { BlockchainAdapterModule } from './modules/blockchain-adapter/blockchain-adapter.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProductionCyclesModule,
    LotsModule,
    ShipmentsModule,
    TraceModule,
    IotModule,
    BlockchainAdapterModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
