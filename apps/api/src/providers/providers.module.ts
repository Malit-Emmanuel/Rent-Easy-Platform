import { Global, Module } from '@nestjs/common';
import { isProductionEnv, loadConfig } from '../config/env';
import { AfricasTalkingSms } from './africastalking.sms';
import { FakePayments, FakeSms } from './fake.adapters';
import { DevLogOtpChannel, SmsOtpChannel } from './otp-channels';
import { OTP_CHANNELS, OtpChannelSet, PAYMENTS_PORT, SMS_PORT, SmsPort } from './ports';
import { MetaWhatsAppChannel } from './whatsapp.meta';

// Adapters are chosen by environment variables (SMS_PROVIDER, WHATSAPP_*, OTP_CHANNELS); see docs/deploy-railway.md.
@Global()
@Module({
  providers: [
    { provide: SMS_PORT, useFactory: (): SmsPort => {
        const c = loadConfig();
        return c.africasTalking ? new AfricasTalkingSms(c.africasTalking) : new FakeSms();
    } },
    { provide: OTP_CHANNELS, inject: [SMS_PORT], useFactory: (sms: SmsPort): OtpChannelSet => {
        const c = loadConfig();
        const set: OtpChannelSet = { dev: new DevLogOtpChannel() };
        // The fake SMS adapter refuses to run in production, so it is not offered there at all.
        if (!(isProductionEnv() && c.smsProvider === 'fake')) set.sms = new SmsOtpChannel(sms);
        if (c.whatsapp) set.whatsapp = new MetaWhatsAppChannel(c.whatsapp);
        return set;
    } },
    { provide: PAYMENTS_PORT, useClass: FakePayments },
  ],
  exports: [SMS_PORT, OTP_CHANNELS, PAYMENTS_PORT],
})
export class ProvidersModule {}
