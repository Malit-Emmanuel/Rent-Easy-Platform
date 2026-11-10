import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { IntegrityService } from './integrity.service';

@Controller('admin/integrity')
export class IntegrityController {
  constructor(@Inject(IntegrityService) private svc: IntegrityService) {}

  @Get('alerts') @Roles('super_admin')
  alerts(@Req() req: any, @Query('status') status?: string) { return this.svc.list(req.user.id, status); }

  @Post('alerts/:id/handle') @HttpCode(200) @Roles('super_admin')
  handle(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) { return this.svc.handle(id, req.user.id, body ?? {}); }

  @Get('rules') @Roles('super_admin')
  rules(@Req() req: any) { return this.svc.rules(req.user.id); }

  @Patch('rules/:code') @Roles('super_admin')
  update(@Req() req: any, @Param('code') code: string, @Body() body: any) { return this.svc.updateRule(code, req.user.id, body ?? {}); }
}
