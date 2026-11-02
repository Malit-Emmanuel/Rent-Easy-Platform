import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { BadgesController } from './badges.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { SupplyModule } from '../supply/supply.module';

@Module({ imports: [SupplyModule], controllers: [CasesController, ReviewController, BadgesController], providers: [CasesService, ReviewService], exports: [CasesService, ReviewService] })
export class VerificationModule {}
