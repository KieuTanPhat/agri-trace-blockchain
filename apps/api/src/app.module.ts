import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { BatchesModule } from './modules/batches/batches.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { TraceModule } from './modules/trace/trace.module.js';
import { IotModule } from './modules/iot/iot.module.js';
import { BlockchainAdapterModule } from './modules/blockchain-adapter/blockchain-adapter.module.js';
import { HealthModule } from './health/health.module.js';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    BatchesModule,
    ShipmentsModule,
    TraceModule,
    IotModule,
    BlockchainAdapterModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
