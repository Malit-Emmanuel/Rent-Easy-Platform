import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { READ, WRITE } from '../supply/supply.roles';
import { T2Service } from './t2.service';

const uuid = () => new ParseUUIDPipe();
const P = 'orgs/:orgId/properties/:propertyId/verification/t2';

@Controller()
export class T2Controller {
  constructor(@Inject(T2Service) private svc: T2Service) {}

  @Get(P) @Roles(...READ)
  status(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string) { return this.svc.status(o, p, req.user.id); }

  @Post(`${P}/challenge`) @HttpCode(201) @Roles(...WRITE)
  challenge(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Body() body: unknown) { return this.svc.issueChallenge(o, p, req.user.id, body); }

  @Post(`${P}/challenge/:challengeId/take`) @HttpCode(201) @Roles(...WRITE)
  take(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Param('challengeId', uuid()) ch: string, @Body() body: unknown) { return this.svc.startTake(o, p, ch, req.user.id, body); }

  @Post(`${P}/submit`) @HttpCode(201) @Roles(...WRITE)
  submit(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Body() body: unknown) { return this.svc.submit(o, p, req.user.id, body); }

  @Post(`${P}/appeal`) @HttpCode(201) @Roles(...WRITE)
  appeal(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string) { return this.svc.appeal(o, p, req.user.id); }
}
