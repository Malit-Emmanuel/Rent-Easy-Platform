import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { PrivacyService } from './privacy.service';

@Controller()
export class PrivacyController {
  constructor(@Inject(PrivacyService) private svc: PrivacyService) {}

  @Get('me/data-export')
  export(@Req() req: any) { return this.svc.exportMine(req.user.id); }

  @Get('me/data-requests')
  mine(@Req() req: any) { return this.svc.mine(req.user.id); }

  @Post('me/data-requests') @HttpCode(201)
  file(@Req() req: any, @Body() body: any) { return this.svc.file(req.user.id, body ?? {}); }

  @Get('admin/privacy/requests') @Roles('super_admin')
  list(@Req() req: any, @Query('status') status?: string) { return this.svc.list(req.user.id, status); }

  @Post('admin/privacy/requests/:id/handle') @HttpCode(200) @Roles('super_admin')
  handle(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) { return this.svc.handle(id, req.user.id, body ?? {}); }
}
