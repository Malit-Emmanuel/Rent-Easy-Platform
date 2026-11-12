import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { clientIp } from './client-ip';
import { Public } from './auth.decorators';
import { AuthService } from './auth.service';

const str = (v: unknown, name: string) => { if (typeof v !== 'string' || !v) throw new BadRequestException(`${name} required`); return v; };
const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  private ip(req: any) { return clientIp(req, this.auth.trustedProxyKey); }

  @Public() @Post('auth/otp/request') @HttpCode(200)
  request(@Req() req: any, @Body() b: any) { return this.auth.requestOtp(str(b?.phone, 'phone'), optStr(b?.channel), this.ip(req)); }

  @Public() @Post('auth/otp/verify') @HttpCode(200)
  verify(@Req() req: any, @Body() b: any) { return this.auth.verifyOtp(str(b?.phone, 'phone'), str(b?.code, 'code'), optStr(b?.deviceId), this.ip(req)); }

  @Public() @Post('auth/refresh') @HttpCode(200)
  refresh(@Body() b: any) { return this.auth.refresh(str(b?.refreshToken, 'refreshToken'), optStr(b?.deviceId)); }

  @Post('auth/logout') @HttpCode(204)
  async logout(@Body() b: any) { await this.auth.logout(optStr(b?.refreshToken) ?? ''); }

  @Get('me')
  me(@Req() req: any) { return req.user; }
}
