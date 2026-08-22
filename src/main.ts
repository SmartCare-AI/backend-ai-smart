import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { resolve } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // --- Security ---
  // crossOriginResourcePolicy relaxed so uploaded images (/files/*) can be
  // displayed inside the mobile/web apps.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Behind nginx: use X-Forwarded-For so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS')?.split(',') ?? true,
    credentials: true,
  });

  // --- Validation: strip unknown fields, reject extras, auto-transform ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api/v1');

  // --- Uploaded files (local storage driver) ---
  // Keys are unguessable UUIDs; served read-only.
  if (config.get<string>('STORAGE_DRIVER', 'local') === 'local') {
    app.useStaticAssets(
      resolve(config.get<string>('UPLOADS_DIR', './uploads')),
      { prefix: '/files/', index: false, fallthrough: true },
    );
  }

  // --- Swagger / OpenAPI ---
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SmartCare AI — API')
    .setDescription(
      [
        'REST API for the SmartCare AI Intelligent Patient Journey Management Platform.',
        '',
        '## Authentication',
        '1. `POST /api/v1/auth/register` → a 6-digit code is emailed to you.',
        '2. `POST /api/v1/auth/verify-email` with the code → returns tokens.',
        '3. Send `Authorization: Bearer <accessToken>` on protected routes (click **Authorize** above).',
        '4. When the access token expires (15 min), call `POST /api/v1/auth/refresh` with your refresh token.',
        '',
        'Google / Apple sign-in: obtain a Firebase ID token on the client, then call `POST /api/v1/auth/social/firebase`.',
        '',
        '## Rate limits',
        'Global: 100 requests/min per IP. Auth endpoints: 3–5 requests/min. Exceeding returns **429**.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .setContact('SmartCare AI Team', '', 'obadayasser40@gmail.com')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the accessToken from login/verify-email.',
      },
      'access-token',
    )
    .addTag('Health', 'Service liveness')
    .addTag('Auth', 'Registration, login, email verification, password reset, social sign-in')
    .addTag('Users', 'Profile management')
    .addTag('Notifications', 'In-app feed + push device tokens (FCM)')
    .addTag('Uploads', 'File storage (pluggable: local disk by default)')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'SmartCare AI API Docs',
    swaggerOptions: {
      persistAuthorization: true, // keep the token across page reloads
      docExpansion: 'list',
      tagsSorter: 'alpha',
    },
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api/v1`);
  logger.log(`Swagger docs on http://localhost:${port}/docs`);
}

void bootstrap();
