import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { READ, WRITE } from '../supply/supply.roles';
import { CasesService } from './cases.service';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class CasesController {
  constructor(@Inject(CasesService) private svc: CasesService) {}

  @Get('orgs/:orgId/properties/:propertyId/verification') @Roles(...READ)
  status(@Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string) { return this.svc.status(orgId, pid); }

  @Post('orgs/:orgId/properties/:propertyId/verification') @Roles(...WRITE)
  request(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string) { return this.svc.request(orgId, pid, req.user.id); }

  @Post('orgs/:orgId/properties/:propertyId/verification/appeal') @HttpCode(201) @Roles(...WRITE)
  appeal(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string) { return this.svc.appeal(orgId, pid, req.user.id); }
}
