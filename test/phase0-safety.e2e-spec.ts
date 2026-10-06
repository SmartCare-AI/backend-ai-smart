import {
  AlertType,
  AppointmentStatus,
  EmergencyStatus,
  EmergencyType,
  ProfileStatus,
} from '@prisma/client';
import { localParts } from '../src/common/utils/timezone.util';
import { ConsentService } from '../src/consent/consent.service';
import { EmergencyService } from '../src/emergency/emergency.service';
import { SMS_PROVIDER } from '../src/emergency/sms/sms-provider.interface';
import type { SmsProvider } from '../src/emergency/sms/sms-provider.interface';
import { SchedulerLockService } from '../src/prisma/scheduler-lock.service';
import {
  createAppointment,
  createDoctor,
  createPatient,
  createTestApp,
  TestContext,
} from './helpers';

describe('Phase 0 — safety and correctness fixes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('doctor access requires a current treating relationship', () => {
    const cases: {
      name: string;
      status: AppointmentStatus;
      inHours: number;
      expected: number;
    }[] = [
      {
        name: 'pending booking',
        status: 'PENDING',
        inHours: 24,
        expected: 403,
      },
      {
        name: 'cancelled booking',
        status: 'CANCELLED',
        inHours: -24,
        expected: 403,
      },
      {
        name: 'confirmed booking',
        status: 'CONFIRMED',
        inHours: 24,
        expected: 200,
      },
      {
        name: 'completed recently',
        status: 'COMPLETED',
        inHours: -24 * 30,
        expected: 200,
      },
      {
        name: 'completed 13 months ago',
        status: 'COMPLETED',
        inHours: -24 * 400,
        expected: 403,
      },
    ];

    it.each(cases)(
      '$name → $expected',
      async ({ status, inHours, expected }) => {
        const patient = await createPatient(ctx.prisma);
        const doctor = await createDoctor(ctx.prisma);
        await createAppointment(ctx.prisma, {
          patientId: patient.profile.id,
          doctorId: doctor.profile.id,
          status,
          inHours,
        });
        await ctx
          .api(doctor.user)
          .get(`/vitals/patients/${patient.profile.id}`)
          .expect(expected);
      },
    );

    it('a suspended doctor loses access', async () => {
      const patient = await createPatient(ctx.prisma);
      const doctor = await createDoctor(ctx.prisma);
      await createAppointment(ctx.prisma, {
        patientId: patient.profile.id,
        doctorId: doctor.profile.id,
        status: 'CONFIRMED',
      });
      await ctx.prisma.doctorProfile.update({
        where: { id: doctor.profile.id },
        data: { status: ProfileStatus.SUSPENDED },
      });
      await ctx
        .api(doctor.user)
        .get(`/vitals/patients/${patient.profile.id}`)
        .expect(403);
    });

    it('the care circle only contains current treating doctors', async () => {
      const patient = await createPatient(ctx.prisma);
      const current = await createDoctor(ctx.prisma);
      const cancelled = await createDoctor(ctx.prisma);
      await createAppointment(ctx.prisma, {
        patientId: patient.profile.id,
        doctorId: current.profile.id,
        status: 'CONFIRMED',
      });
      await createAppointment(ctx.prisma, {
        patientId: patient.profile.id,
        doctorId: cancelled.profile.id,
        status: 'CANCELLED',
      });
      const circle = await ctx.app
        .get(ConsentService)
        .patientCircleUserIds(patient.profile.id);
      expect(circle).toEqual([current.user.id]);
    });
  });

  describe('medication doses follow the patient time zone', () => {
    it.each(['Africa/Cairo', 'America/New_York'])(
      'a once-daily dose is due at 09:00 local time in %s',
      async (timezone) => {
        const patient = await createPatient(ctx.prisma, { timezone });
        const doctor = await createDoctor(ctx.prisma);
        await createAppointment(ctx.prisma, {
          patientId: patient.profile.id,
          doctorId: doctor.profile.id,
          status: 'CONFIRMED',
        });

        const plan = await ctx
          .api(doctor.user)
          .post('/treatment-plans')
          .send({ patientId: patient.profile.id, description: 'Hypertension' })
          .expect(201);
        await ctx
          .api(doctor.user)
          .post('/prescriptions')
          .send({
            treatmentPlanId: plan.body.id,
            items: [
              {
                medicineName: 'Amlodipine',
                dose: '5 mg',
                timesPerDay: 1,
                durationDays: 3,
              },
            ],
          })
          .expect(201);

        const doses = await ctx.prisma.medicineTracking.findMany({
          where: { patientId: patient.profile.id },
          orderBy: { scheduledTime: 'asc' },
        });
        expect(doses).toHaveLength(3);
        for (const dose of doses) {
          expect(localParts(dose.scheduledTime, timezone)).toMatchObject({
            hour: 9,
            minute: 0,
          });
        }
      },
    );

    it('rejects an invalid time zone on the profile', async () => {
      const patient = await createPatient(ctx.prisma);
      await ctx
        .api(patient.user)
        .patch('/users/me')
        .send({ timezone: 'Mars/Olympus' })
        .expect(400);
      const res = await ctx
        .api(patient.user)
        .patch('/users/me')
        .send({ timezone: 'Asia/Riyadh' })
        .expect(200);
      expect(res.body.patientProfile.timezone).toBe('Asia/Riyadh');
    });
  });

  describe('emergency escalation survives a lost timer', () => {
    it('the sweeper escalates overdue emergencies exactly once', async () => {
      const sms = ctx.app.get<SmsProvider>(SMS_PROVIDER);
      const send = jest.spyOn(sms, 'send').mockResolvedValue(undefined);
      const patient = await createPatient(ctx.prisma);
      await ctx.prisma.emergencyContact.createMany({
        data: [
          {
            patientId: patient.profile.id,
            name: 'Mona',
            phone: '+201000000001',
            priority: 1,
          },
          {
            patientId: patient.profile.id,
            name: 'Ali',
            phone: '+201000000002',
            priority: 2,
          },
        ],
      });
      // As if the server restarted after opening the event: no timer exists.
      const event = await ctx.prisma.emergencyEvent.create({
        data: {
          patientId: patient.profile.id,
          type: EmergencyType.SOS_BUTTON,
          createdAt: new Date(Date.now() - 10 * 60_000),
        },
      });
      const acknowledged = await ctx.prisma.emergencyEvent.create({
        data: {
          patientId: patient.profile.id,
          type: EmergencyType.SOS_BUTTON,
          status: EmergencyStatus.ACKNOWLEDGED,
          createdAt: new Date(Date.now() - 10 * 60_000),
        },
      });

      const emergency = ctx.app.get(EmergencyService);
      await emergency.sweepOverdue();
      await emergency.sweepOverdue();
      await emergency.escalate(event.id); // a late queue job is a no-op too

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls.map((c) => c[0])).toEqual([
        '+201000000001',
        '+201000000002',
      ]);
      const after = await ctx.prisma.emergencyEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(after.escalatedAt).not.toBeNull();
      const ack = await ctx.prisma.emergencyEvent.findUniqueOrThrow({
        where: { id: acknowledged.id },
      });
      expect(ack.escalatedAt).toBeNull();
      send.mockRestore();
    });
  });

  describe('scheduler lock', () => {
    it('lets exactly one concurrent run through', async () => {
      const locks = ctx.app.get(SchedulerLockService);
      let runs = 0;
      const work = async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 200));
      };
      const results = await Promise.all([
        locks.runExclusive('test-lock', 10_000, work),
        locks.runExclusive('test-lock', 10_000, work),
        locks.runExclusive('test-lock', 10_000, work),
      ]);
      expect(runs).toBe(1);
      expect(results.filter(Boolean)).toHaveLength(1);
      // Released afterwards: the next run goes through.
      expect(await locks.runExclusive('test-lock', 10_000, work)).toBe(true);
    });
  });

  describe('AI triage', () => {
    it('a CRITICAL result alerts the care circle and opens an emergency', async () => {
      const patient = await createPatient(ctx.prisma);
      const res = await ctx
        .api(patient.user)
        .post('/ai/triage')
        .send({ symptoms: [{ name: 'chest pain', severity: 'severe' }] })
        .expect(201);

      expect(res.body.riskLevel).toBe('CRITICAL');
      expect(res.body.emergencyAlertId).toEqual(expect.any(Number));
      expect(res.body.doctorSearch).toEqual({
        specialization: res.body.suggestedSpecialty,
      });

      const alert = await ctx.prisma.alert.findUniqueOrThrow({
        where: { id: res.body.emergencyAlertId },
      });
      expect(alert.type).toBe(AlertType.AI_RISK);
      const emergency = await ctx.prisma.emergencyEvent.findFirst({
        where: { alertId: alert.id },
      });
      expect(emergency?.status).toBe(EmergencyStatus.ACTIVE);

      const assessment = await ctx.prisma.assessment.findUniqueOrThrow({
        where: { id: res.body.assessmentId },
      });
      expect(assessment.aiEngine).toBe('rules');
    });

    it('a mild result opens nothing', async () => {
      const patient = await createPatient(ctx.prisma);
      const res = await ctx
        .api(patient.user)
        .post('/ai/triage')
        .send({ symptoms: [{ name: 'itchy skin', severity: 'mild' }] })
        .expect(201);
      expect(res.body.emergencyAlertId).toBeNull();
    });
  });
});
