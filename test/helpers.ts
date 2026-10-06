import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AppointmentStatus,
  AppointmentType,
  Role,
  type User,
} from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Shared e2e harness: boots the real AppModule (same global pipes and prefix
 * as main.ts) against the TEST database, and offers small factories that
 * write rows directly so each test sets up exactly the state it needs.
 */
export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  jwt: JwtService;
  /** Authenticated request helper: api(user).get('/appointments/my') */
  api: (user?: Pick<User, 'id' | 'email' | 'role'>) => AuthedAgent;
  close: () => Promise<void>;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type AuthedAgent = Record<Method, (path: string) => request.Test>;

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);
  await resetDatabase(prisma);

  const api = (user?: Pick<User, 'id' | 'email' | 'role'>): AuthedAgent => {
    const token = user
      ? jwt.sign({ sub: user.id, email: user.email, role: user.role })
      : undefined;
    const wrap =
      (method: Method) =>
      (path: string): request.Test => {
        const req = request(app.getHttpServer())[method](`/api/v1${path}`);
        return token ? req.set('Authorization', `Bearer ${token}`) : req;
      };
    return {
      get: wrap('get'),
      post: wrap('post'),
      patch: wrap('patch'),
      put: wrap('put'),
      delete: wrap('delete'),
    };
  };

  return { app, prisma, jwt, api, close: () => app.close() };
}

/** Empties every table (keeps the migration history). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let seq = 0;
const nextEmail = (prefix: string) => `${prefix}${++seq}-${Date.now()}@test.dev`;

export async function createPatient(
  prisma: PrismaService,
  opts: { timezone?: string; firstName?: string } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: nextEmail('patient'),
      role: Role.PATIENT,
      isEmailVerified: true,
      patientProfile: {
        create: {
          firstName: opts.firstName ?? 'Omar',
          lastName: 'Patient',
          medicalRecordNo: `SH-TEST-${++seq}-${Date.now()}`,
          ...(opts.timezone ? { timezone: opts.timezone } : {}),
        },
      },
    },
    include: { patientProfile: true },
  });
  return { user, profile: user.patientProfile! };
}

export async function createDoctor(
  prisma: PrismaService,
  opts: { specialization?: string; firstName?: string } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: nextEmail('doctor'),
      role: Role.DOCTOR,
      isEmailVerified: true,
      doctorProfile: {
        create: {
          firstName: opts.firstName ?? 'Ahmed',
          lastName: 'Doctor',
          licenseNumber: `LIC-${++seq}-${Date.now()}`,
          specialization: opts.specialization ?? 'cardiology',
          isVerified: true,
        },
      },
    },
    include: { doctorProfile: true },
  });
  return { user, profile: user.doctorProfile! };
}

export async function createAdmin(prisma: PrismaService) {
  return prisma.user.create({
    data: {
      email: nextEmail('admin'),
      role: Role.ADMIN,
      isEmailVerified: true,
    },
  });
}

export async function createAppointment(
  prisma: PrismaService,
  input: {
    patientId: number;
    doctorId: number;
    status?: AppointmentStatus;
    /** Hours from now (negative = in the past). Default +24. */
    inHours?: number;
    type?: AppointmentType;
  },
) {
  const start = new Date(Date.now() + (input.inHours ?? 24) * 3_600_000);
  return prisma.appointment.create({
    data: {
      patientId: input.patientId,
      doctorId: input.doctorId,
      status: input.status ?? AppointmentStatus.PENDING,
      type: input.type ?? AppointmentType.IN_PERSON,
      date: new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate(),
        ),
      ),
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
    },
  });
}
