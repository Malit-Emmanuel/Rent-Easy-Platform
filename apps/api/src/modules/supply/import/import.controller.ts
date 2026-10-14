import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../../common/rbac';
import { READ, WRITE } from '../supply.roles';
import { ImportService } from './import.service';

const uuid = () => new ParseUUIDPipe();

@Controller('orgs/:orgId/imports')
export class ImportController {
  constructor(@Inject(ImportService) private svc: ImportService) {}

  @Post('preview') @HttpCode(200) @Roles(...WRITE)
  preview(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Body() b: any) { return this.svc.preview(orgId, req.user.id, b?.fileName, b?.csv); }

  @Get() @Roles(...READ)
  list(@Param('orgId', uuid()) orgId: string) { return this.svc.list(orgId); }

  @Get(':runId') @Roles(...READ)
  get(@Param('orgId', uuid()) orgId: string, @Param('runId', uuid()) runId: string) { return this.svc.get(orgId, runId); }

  @Post(':runId/commit') @HttpCode(200) @Roles(...WRITE)
  commit(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('runId', uuid()) runId: string) { return this.svc.commit(orgId, runId, req.user.id); }
}
