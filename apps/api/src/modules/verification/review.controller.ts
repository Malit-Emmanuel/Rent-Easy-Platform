import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { ReviewService } from './review.service';

const uuid = () => new ParseUUIDPipe();

@Controller('review/cases')
export class ReviewController {
  constructor(@Inject(ReviewService) private svc: ReviewService) {}

  @Get('queue') @Roles('reviewer')
  queue(@Req() req: any) { return this.svc.queue(req.user.id); }

  @Post(':id/claim') @HttpCode(200) @Roles('reviewer')
  claim(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.claim(id, req.user.id); }

  @Post(':id/release') @HttpCode(200) @Roles('reviewer')
  release(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.release(id, req.user.id); }
}
