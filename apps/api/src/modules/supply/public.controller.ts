import { BadRequestException, Controller, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { clientIp } from '../auth/client-ip';
import { parsePublicQuery, RateWindow } from './public.rules';
import { PublicListingsService } from './public.service';

/** The switch. Search stays closed (404, as if it did not exist) until PUBLIC_SEARCH_ENABLED=true is set on purpose, after the lawyer has cleared it. */
export const publicSearchOpen = () => process.env.PUBLIC_SEARCH_ENABLED === 'true';

@Controller('public')
export class PublicListingsController {
  private limiter?: RateWindow; private limiterKey = '';
  constructor(@Inject(PublicListingsService) private svc: PublicListingsService) {}

  /** The request limit is read on each call so a change of setting takes effect without code changes. */
  private gate(req: any) {
    if (!publicSearchOpen()) throw new NotFoundException('Not found');
    const max = Number(process.env.PUBLIC_RATE_PER_10MIN ?? 120) || 120;
    if (!this.limiter || this.limiterKey !== String(max)) { this.limiter = new RateWindow(max, 10 * 60 * 1000); this.limiterKey = String(max); }
    const ip = clientIp(req, process.env.TRUSTED_PROXY_KEY || undefined) ?? 'unknown';
    if (!this.limiter.take(ip)) throw new HttpException('Too many requests. Please wait a few minutes.', 429);
  }

  @Public() @Get('listings')
  search(@Req() req: any, @Query() query: Record<string, unknown>) {
    this.gate(req);
    const p = parsePublicQuery(query);
    if (p.errors.length) throw new BadRequestException(p.errors.join('; '));
    return this.svc.search(p.value);
  }

  @Public() @Get('listings/:id')
  one(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) { this.gate(req); return this.svc.one(id); }

  @Public() @Get('areas')
  areas(@Req() req: any) { this.gate(req); return this.svc.areas(); }
}
