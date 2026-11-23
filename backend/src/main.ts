import 'dotenv/config';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { bodyParserEnabled } from './auth/auth-mode.js';
import { corsOrigins } from './http/cors-origins.js';
import { setupSwagger } from './http/swagger.js';
import { trustProxyHops } from './http/trust-proxy.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: bodyParserEnabled,
    instrument: ObserveInstrument,
  });
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.disable('x-powered-by');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.set('trust proxy', trustProxyHops());
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
