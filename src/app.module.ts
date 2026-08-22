import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AlertsModule } from './alerts/alerts.module';
import { AppController } from './app.controller';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { TreatmentModule } from './treatment/treatment.module';
import { VisitsModule } from './visits/visits.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { ConsentModule } from './consent/consent.module';
import { EmergencyModule } from './emergency/emergency.module';
import { FirebaseModule } from './firebase/firebase.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queues/queue.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { VitalsModule } from './vitals/vitals.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),

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
    QueueModule,
    AuditModule,
    ConsentModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    HospitalsModule,
    AppointmentsModule,
    VisitsModule,
    TreatmentModule,
    EmergencyModule,
    AlertsModule,
    VitalsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: throttling runs before authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Secure by default: every route requires a JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Role check runs after authentication (needs request.user).
    { provide: APP_GUARD, useClass: RolesGuard },
    // Compliance trail for every successful mutating request.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
