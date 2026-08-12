import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validateEnv } from './config/env.validation';
import { FirebaseModule } from './firebase/firebase.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // Rate limiting — global safety net of 100 req/min per IP.
    // Sensitive endpoints override this with stricter @Throttle() limits.
    // Uses Redis when REDIS_URL is set (required for multi-instance deploys),
    // otherwise falls back to in-memory storage for local development.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        return {
          throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
          storage: redisUrl
            ? new ThrottlerStorageRedisService(
                new Redis(redisUrl, { maxRetriesPerRequest: 2 }),
              )
            : undefined,
        };
      },
    }),

    PrismaModule,
    MailModule,
    FirebaseModule,
    AuthModule,
    UsersModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: throttling runs before authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Secure by default: every route requires a JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
