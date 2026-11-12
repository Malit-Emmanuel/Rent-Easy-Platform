import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { ReviewService } from './review.service';

const uuid = () => new ParseUUIDPipe();

@Controller('review/cases')
export class ReviewController {
  constructor(@Inject(ReviewService) private svc: ReviewService) {}

  @Get('queue') @Roles('reviewer')
  queue(@Req() req: any) { return this.svc.queue(req.user.id); }

  @Get('history') @Roles('reviewer')
  history(@Req() req: any) { return this.svc.history(req.user.id); }

  @Get('my-stats') @Roles('reviewer')
  myStats(@Req() req: any, @Query('month') month?: string) { return this.svc.myStats(req.user.id, month); }

  @Post(':id/claim') @HttpCode(200) @Roles('reviewer')
  claim(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.claim(id, req.user.id); }

  @Post(':id/release') @HttpCode(200) @Roles('reviewer')
  release(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.release(id, req.user.id); }

  @Get(':id') @Roles('reviewer')
  detail(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.detail(id, req.user.id); }

  @Post(':id/files/:fileId/link') @HttpCode(200) @Roles('reviewer')
  link(@Req() req: any, @Param('id', uuid()) id: string, @Param('fileId', uuid()) fileId: string) { return this.svc.openFile(id, fileId, req.user.id); }

  @Post(':id/video/link') @HttpCode(200) @Roles('reviewer')
  videoLink(@Req() req: any, @Param('id', uuid()) id: string) { return this.svc.openVideo(id, req.user.id); }

  @Post(':id/decision') @HttpCode(200) @Roles('reviewer')
  decide(@Req() req: any, @Param('id', uuid()) id: string, @Body() body: any) { return this.svc.decide(id, req.user.id, body ?? {}); }
}
