import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

/** Shared by the long-running server (main.ts) and the serverless handler. */
export function configureApp(app: INestApplication) {
  (app as NestExpressApplication).useBodyParser('json', { limit: '3mb' });   // spreadsheet imports are up to 2 MB of text; everything else is tiny
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : false, credentials: false });
}
