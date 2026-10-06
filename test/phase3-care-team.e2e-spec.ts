import { AppointmentStatus, CareRelationshipStatus } from '@prisma/client';
import {
  createAppointment,
  createDoctor,
  createPatient,
  createTestApp,
  TestContext,
} from './helpers';

describe('Phase 3 — care team and access transparency', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  /** Waits for fire-and-forget audit writes to land. */
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('confirming an appointment grants access; the patient sees and revokes it', async () => {
    const patient = await createPatient(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma, { firstName: 'Laila' });
    const appointment = await createAppointment(ctx.prisma, {
      patientId: patient.profile.id,
      doctorId: doctor.profile.id,
      inHours: 2,
    });
    const records = () =>
      ctx.api(doctor.user).get(`/vitals/patients/${patient.profile.id}`);

    // Pending: the doctor can read the booking itself, not the record.
    const booking = await ctx
      .api(doctor.user)
      .get(`/appointments/${appointment.id}`)
      .expect(200);
    expect(booking.body.patient.userId).toBeUndefined();
    await records().expect(403);

    await ctx
      .api(doctor.user)
      .patch(`/appointments/${appointment.id}/confirm`)
      .expect(200);
    await records().expect(200);

    const team = await ctx
      .api(patient.user)
      .get('/patients/me/care-team')
      .expect(200);
    expect(team.body.items).toHaveLength(1);
    expect(team.body.items[0].doctor.firstName).toBe('Laila');
    expect(team.body.items[0].nextAppointment.id).toBe(appointment.id);

    // Upcoming appointment blocks revocation.
    const relationshipId = team.body.items[0].id;
    await ctx
      .api(patient.user)
      .delete(`/patients/me/care-team/${relationshipId}`)
      .expect(409);

    await ctx
      .api(patient.user)
      .patch(`/appointments/${appointment.id}/cancel`)
      .send({})
      .expect(200);
    // Cancelling the only appointment also ends access.
    await records().expect(403);
  });

  it('a visit extends access; the patient can revoke it', async () => {
    const patient = await createPatient(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma);
    const appointment = await createAppointment(ctx.prisma, {
      patientId: patient.profile.id,
      doctorId: doctor.profile.id,
      status: AppointmentStatus.CONFIRMED,
      inHours: -1,
    });
    await ctx
      .api(doctor.user)
      .post('/visits')
      .send({ appointmentId: appointment.id })
      .expect(201);

    const relationship = await ctx.prisma.careRelationship.findUniqueOrThrow({
      where: {
        patientId_doctorId: {
          patientId: patient.profile.id,
          doctorId: doctor.profile.id,
        },
      },
    });
    const elevenMonths = Date.now() + 330 * 86_400_000;
    expect(relationship.expiresAt.getTime()).toBeGreaterThan(elevenMonths);

    const mine = await ctx
      .api(doctor.user)
      .get('/doctors/me/patients')
      .expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      patient: { id: patient.profile.id },
      openAlerts: 0,
      adherenceScore30d: null,
    });
    expect(mine.body.items[0].lastVisitAt).not.toBeNull();

    await ctx
      .api(patient.user)
      .delete(`/patients/me/care-team/${relationship.id}`)
      .expect(200);
    await ctx
      .api(doctor.user)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(403);
    const after = await ctx
      .api(doctor.user)
      .get('/doctors/me/patients')
      .expect(200);
    expect(after.body.items).toHaveLength(0);
    const revoked = await ctx.prisma.careRelationship.findUniqueOrThrow({
      where: { id: relationship.id },
    });
    expect(revoked.status).toBe(CareRelationshipStatus.REVOKED);
  });

  it('a new confirmed booking re-activates a revoked relationship', async () => {
    const patient = await createPatient(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma);
    await ctx.prisma.careRelationship.create({
      data: {
        patientId: patient.profile.id,
        doctorId: doctor.profile.id,
        status: CareRelationshipStatus.REVOKED,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const appointment = await createAppointment(ctx.prisma, {
      patientId: patient.profile.id,
      doctorId: doctor.profile.id,
    });
    await ctx
      .api(doctor.user)
      .patch(`/appointments/${appointment.id}/confirm`)
      .expect(200);
    await ctx
      .api(doctor.user)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(200);
  });

  it('the patient sees who opened their record, including refusals', async () => {
    const patient = await createPatient(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma, { firstName: 'Hany' });
    const stranger = await createDoctor(ctx.prisma, { firstName: 'Nosy' });
    await createAppointment(ctx.prisma, {
      patientId: patient.profile.id,
      doctorId: doctor.profile.id,
      status: AppointmentStatus.CONFIRMED,
    });

    await ctx
      .api(doctor.user)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(200);
    await ctx
      .api(doctor.user)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(200);
    await ctx
      .api(stranger.user)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(403);
    await settle();

    const history = await ctx
      .api(patient.user)
      .get('/patients/me/access-history')
      .expect(200);
    // Two reads by the same doctor within 5 minutes are grouped.
    expect(history.body.total).toBe(2);
    const outcomes = (
      history.body.items as { outcome: string; actor: { name: string } }[]
    )
      .map((i) => `${i.actor.name}:${i.outcome}`)
      .sort();
    expect(outcomes).toEqual(['Hany Doctor:ALLOWED', 'Nosy Doctor:DENIED']);
  });
});
