import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { ReviewService } from './review.service';

@Controller('review/badges')
export class BadgesController {
  constructor(@Inject(ReviewService) private svc: ReviewService) {}

  @Get() @Roles('reviewer')
  list(@Req() req: any) { return this.svc.badges(req.user.id); }

  @Post(':id/revoke') @HttpCode(200) @Roles('reviewer')
  revoke(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) { return this.svc.revoke(id, req.user.id, body ?? {}); }
}
