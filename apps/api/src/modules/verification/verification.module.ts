import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({ controllers: [CasesController, ReviewController], providers: [CasesService, ReviewService], exports: [CasesService, ReviewService] })
export class VerificationModule {}
