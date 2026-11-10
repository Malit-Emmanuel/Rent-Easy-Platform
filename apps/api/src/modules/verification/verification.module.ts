import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { BadgesController } from './badges.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { AdminReviewController } from './admin.review.controller';
import { AdminReviewService } from './admin.review.service';
import { T2Controller } from './t2.controller';
import { T2Service } from './t2.service';
import { T2RetentionService } from './t2.retention';
import { SupplyModule } from '../supply/supply.module';

@Module({ imports: [SupplyModule], controllers: [CasesController, T2Controller, ReviewController, AdminReviewController, BadgesController], providers: [CasesService, T2Service, T2RetentionService, ReviewService, AdminReviewService], exports: [CasesService, T2Service, T2RetentionService, ReviewService, AdminReviewService] })
export class VerificationModule {}
