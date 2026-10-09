import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { SupplyService } from './supply.service';
import { checkProperty, checkUnit, pageLimit } from './supply.validation';

const READ = ['manager_admin', 'manager_staff', 'landlord', 'agent'] as const;
const WRITE = READ;                                   // anyone in the organisation who manages supply
const ARCHIVE = ['manager_admin', 'landlord'] as const;   // removing things is for owners and administrators
const uuid = () => new ParseUUIDPipe();
const ok = <T>(c: { value: T; errors: string[] }): T => { if (c.errors.length) throw new BadRequestException(c.errors.join('; ')); return c.value; };

@Controller()
export class SupplyController {
  constructor(@Inject(SupplyService) private svc: SupplyService) {}

  @Get('nodes') nodes() { return this.svc.nodes(); }

  @Get('orgs/:orgId/properties') @Roles(...READ)
  list(@Param('orgId', uuid()) orgId: string, @Query('limit') limit?: string) { return this.svc.listProperties(orgId, pageLimit(limit)); }

  @Post('orgs/:orgId/properties') @Roles(...WRITE)
  create(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Body() b: any) { return this.svc.createProperty(orgId, req.user.id, ok(checkProperty(b, 'create'))); }

  @Get('orgs/:orgId/properties/:propertyId') @Roles(...READ)
  get(@Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string) { return this.svc.getProperty(orgId, pid); }

  @Patch('orgs/:orgId/properties/:propertyId') @Roles(...WRITE)
  update(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Body() b: any) {
    return this.svc.updateProperty(orgId, pid, req.user.id, ok(checkProperty(b, 'update')));
  }

  @Post('orgs/:orgId/properties/:propertyId/archive') @HttpCode(204) @Roles(...ARCHIVE)
  async archive(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string) { await this.svc.archiveProperty(orgId, pid, req.user.id); }

  @Get('orgs/:orgId/properties/:propertyId/units') @Roles(...READ)
  units(@Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Query('limit') limit?: string) { return this.svc.listUnits(orgId, pid, pageLimit(limit)); }

  @Post('orgs/:orgId/properties/:propertyId/units') @Roles(...WRITE)
  createUnit(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Body() b: any) {
    return this.svc.createUnit(orgId, pid, req.user.id, ok(checkUnit(b, 'create')));
  }

  @Patch('orgs/:orgId/properties/:propertyId/units/:unitId') @Roles(...WRITE)
  updateUnit(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Param('unitId', uuid()) uid: string, @Body() b: any) {
    return this.svc.updateUnit(orgId, pid, uid, req.user.id, ok(checkUnit(b, 'update')));
  }

  @Post('orgs/:orgId/properties/:propertyId/units/:unitId/archive') @HttpCode(204) @Roles(...ARCHIVE)
  async archiveUnit(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Param('unitId', uuid()) uid: string) {
    await this.svc.archiveUnit(orgId, pid, uid, req.user.id);
  }
}
