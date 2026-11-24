import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { checkCosts } from './listings.rules';
import { ListingsService } from './listings.service';
import { READ, WRITE } from './supply.roles';
import { pageLimit } from './supply.validation';

const uuid = () => new ParseUUIDPipe();
const STATUSES = ['draft', 'published', 'stale', 'let', 'withdrawn'];

@Controller()
export class ListingsController {
  constructor(@Inject(ListingsService) private svc: ListingsService) {}

  @Get('orgs/:orgId/listings') @Roles(...READ)
  list(@Param('orgId', uuid()) orgId: string, @Query('status') status?: string, @Query('propertyId') propertyId?: string, @Query('limit') limit?: string) {
    if (status && !STATUSES.includes(status)) throw new BadRequestException('unknown status');
    if (propertyId && !/^[0-9a-f-]{36}$/i.test(propertyId)) throw new BadRequestException('propertyId must be an id');
    return this.svc.list(orgId, { status, propertyId, limit: pageLimit(limit) });
  }

  @Get('orgs/:orgId/listings/:listingId') @Roles(...READ)
  get(@Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string) { return this.svc.get(orgId, id); }

  /** Starts a draft for a unit. Costs may be given now or later. */
  @Post('orgs/:orgId/properties/:propertyId/units/:unitId/listings') @Roles(...WRITE)
  create(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('propertyId', uuid()) pid: string, @Param('unitId', uuid()) uid: string, @Body() b: any) {
    let costs = null;
    if (b && typeof b === 'object' && Object.keys(b).length) { const c = checkCosts(b, 'some'); if (c.errors.length) throw new BadRequestException(c.errors.join('; ')); costs = c.value; }
    return this.svc.create(orgId, pid, uid, req.user.id, costs);
  }

  @Put('orgs/:orgId/listings/:listingId/costs') @Roles(...WRITE)
  costs(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string, @Body() b: any) {
    const c = checkCosts(b, 'some'); if (c.errors.length) throw new BadRequestException(c.errors.join('; '));
    return this.svc.setCosts(orgId, id, req.user.id, c.value);
  }

  @Post('orgs/:orgId/listings/:listingId/publish') @Roles(...WRITE)
  publish(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string) { return this.svc.publish(orgId, id, req.user.id); }

  @Post('orgs/:orgId/listings/:listingId/confirm') @Roles(...WRITE)
  confirm(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string) { return this.svc.confirm(orgId, id, req.user.id); }

  @Post('orgs/:orgId/listings/:listingId/let') @Roles(...WRITE)
  let(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string) { return this.svc.close(orgId, id, req.user.id, 'let'); }

  @Post('orgs/:orgId/listings/:listingId/withdraw') @Roles(...WRITE)
  withdraw(@Req() req: any, @Param('orgId', uuid()) orgId: string, @Param('listingId', uuid()) id: string) { return this.svc.close(orgId, id, req.user.id, 'withdrawn'); }
}
