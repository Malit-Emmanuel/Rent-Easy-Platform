import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/rbac';
import { ReportsService } from './reports.service';

@Controller('admin')
export class ReportsController {
  constructor(@Inject(ReportsService) private svc: ReportsService) {}

  @Get('reports/queue') @Roles('super_admin')
  queue(@Req() req: any, @Query('month') month?: string) { return this.svc.queue(req.user.id, month); }

  @Get('reports/cost') @Roles('super_admin')
  cost(@Req() req: any, @Query('month') month?: string) { return this.svc.cost(req.user.id, month); }

  @Get('reports/reviewers') @Roles('super_admin')
  reviewers(@Req() req: any, @Query('month') month?: string) { return this.svc.reviewers(req.user.id, month); }

  @Get('cost-inputs') @Roles('super_admin')
  inputs(@Req() req: any, @Query('month') month?: string) { return this.svc.listCostInputs(req.user.id, month); }

  @Post('cost-inputs') @HttpCode(201) @Roles('super_admin')
  add(@Req() req: any, @Body() body: any) { return this.svc.addCostInput(req.user.id, body ?? {}); }
}
