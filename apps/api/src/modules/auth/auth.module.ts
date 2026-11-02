import { Module } from '@nestjs/common';
import { loadConfig } from '../../config/env';
import { MembersController } from '../orgs/members.controller';
import { OrgsController } from '../orgs/orgs.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OTP_POLICY, OtpDeliveryService, OtpPolicy } from './otp-delivery.service';
import { AUTH_CONFIG, AuthConfig, AuthService, defaultAuthTuning } from './auth.service';

@Module({
  controllers: [AuthController, OrgsController, MembersController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: (): AuthConfig => {
        const c = loadConfig();
        return { ...defaultAuthTuning, jwtSecret: c.jwtSecret, otpPepper: c.otpPepper, resendCooldownSec: c.otpResendCooldownSec };
    } },
    { provide: OTP_POLICY, useFactory: (): OtpPolicy => {
        const c = loadConfig();
        return { order: c.otpChannels, dailyCap: c.otpDailyCap, allowlist: c.devOtpAllowlist };
    } },
    OtpDeliveryService, AuthService, AuthGuard,
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
