import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { BadgesController } from './badges.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { T2Controller } from './t2.controller';
import { T2Service } from './t2.service';
import { SupplyModule } from '../supply/supply.module';

@Module({ imports: [SupplyModule], controllers: [CasesController, T2Controller, ReviewController, BadgesController], providers: [CasesService, T2Service, ReviewService], exports: [CasesService, T2Service, ReviewService] })
export class VerificationModule {}
