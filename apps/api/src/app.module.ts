import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/rbac';
import { AuditModule } from './modules/audit/audit.service';
import { HealthController } from './modules/health/health.controller';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ConsentService } from './modules/consent/consent.service';
import { EventsModule } from './modules/events/events.module';
import { SupplyModule } from './modules/supply/supply.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { VerificationModule } from './modules/verification/verification.module';
import { ProvidersModule } from './providers/providers.module';

@Module({
  imports: [AuditModule, EventsModule, ProvidersModule, AuthModule, IdentityModule, JobsModule, SupplyModule, VerificationModule, IntegrityModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }, ConsentService],
})
export class AppModule {}
