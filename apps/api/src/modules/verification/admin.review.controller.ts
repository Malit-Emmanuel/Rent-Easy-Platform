import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { AdminReviewService } from './admin.review.service';

@Controller('admin/review')
export class AdminReviewController {
  constructor(@Inject(AdminReviewService) private svc: AdminReviewService) {}

  @Get('stale-claims') @Roles('super_admin')
  stale(@Req() req: any) { return this.svc.staleClaims(req.user.id); }

  @Post('cases/:id/release') @HttpCode(200) @Roles('super_admin')
  release(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) { return this.svc.releaseStale(id, req.user.id, body ?? {}); }
}
