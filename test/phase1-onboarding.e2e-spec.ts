import { AppointmentStatus, Role } from '@prisma/client';
import { MailService } from '../src/mail/mail.service';
import {
  createAdmin,
  createAppointment,
  createDoctor,
  createPatient,
  createTestApp,
  TestContext,
} from './helpers';

describe('Phase 1 — doctor self-registration and doctor search', () => {
  let ctx: TestContext;
  /** Last OTP emailed per address (the mail service is spied on). */
  const codes = new Map<string, string>();

  beforeAll(async () => {
    ctx = await createTestApp();
    jest
      .spyOn(ctx.app.get(MailService), 'sendVerificationCode')
      .mockImplementation((to: string, _name: string, code: string) => {
        codes.set(to, code);
        return Promise.resolve();
      });
  });
  afterAll(() => ctx.close());

  const doctorBody = (email: string, license: string) => ({
    email,
    password: 'Passw0rd!',
    firstName: 'Sara',
    lastName: 'Nabil',
    accountType: 'DOCTOR',
    doctor: {
      specialization: 'Cardiology', // normalized to the lowercase key
      yearsOfExperience: 9,
      licenseNumber: license,
      bio: 'Heart failure clinic.',
    },
  });

  it('a doctor registers, verifies the email, is searchable and bookable', async () => {
    const email = 'sara.doctor@test.dev';
    await ctx
      .api()
      .post('/auth/register')
      .send(doctorBody(email, 'EG-111'))
      .expect(201);

    // Not listed before the email is verified.
    const before = await ctx.api().get('/doctors?q=nabil').expect(200);
    expect(before.body.total).toBe(0);

    const verified = await ctx
      .api()
      .post('/auth/verify-email')
      .send({ email, code: codes.get(email) })
      .expect(200);
    expect(verified.body.user.role).toBe(Role.DOCTOR);
    expect(verified.body.user.doctorProfile).toMatchObject({
      specialization: 'cardiology',
      yearsOfExperience: 9,
      isVerified: true,
    });
    expect(verified.body.user.patientProfile).toBeNull();

    const found = await ctx
      .api()
      .get('/doctors?specialization=cardiology&q=sara nabil')
      .expect(200);
    expect(found.body.total).toBe(1);
    const card = found.body.items[0];
    expect(card).toMatchObject({
      firstName: 'Sara',
      specialization: 'cardiology',
    });
    expect(card.licenseNumber).toBeUndefined(); // not public

    await ctx.api().get(`/doctors/${card.id}`).expect(200);

    const patient = await createPatient(ctx.prisma);
    await ctx
      .api(patient.user)
      .post('/appointments')
      .send({
        patientId: patient.profile.id,
        doctorId: card.id,
        startTime: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      })
      .expect(201);
  });

  it('validates the doctor block', async () => {
    const base = doctorBody('bad@test.dev', 'EG-222');
    await ctx
      .api()
      .post('/auth/register')
      .send({ ...base, doctor: undefined })
      .expect(400);
    await ctx
      .api()
      .post('/auth/register')
      .send({
        ...base,
        doctor: { ...base.doctor, specialization: 'astrology' },
      })
      .expect(400);
    await ctx
      .api()
      .post('/auth/register')
      .send({ ...base, doctor: { ...base.doctor, hospitalId: 999999 } })
      .expect(400);
  });

  it('rejects a license number that belongs to someone else', async () => {
    const existing = await createDoctor(ctx.prisma);
    await ctx
      .api()
      .post('/auth/register')
      .send(doctorBody('dup@test.dev', existing.profile.licenseNumber))
      .expect(409);
  });

  it('re-registering an unverified account can switch the account type', async () => {
    const email = 'switch@test.dev';
    await ctx
      .api()
      .post('/auth/register')
      .send(doctorBody(email, 'EG-333'))
      .expect(201);
    await ctx
      .api()
      .post('/auth/register')
      .send({
        email,
        password: 'Passw0rd!',
        firstName: 'Sara',
        lastName: 'Nabil',
      })
      .expect(201);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { doctorProfile: true, patientProfile: true },
    });
    expect(user.role).toBe(Role.PATIENT);
    expect(user.doctorProfile).toBeNull();
    expect(user.patientProfile).not.toBeNull();
    // The freed license can be used again.
    await ctx
      .api()
      .post('/auth/register')
      .send(doctorBody('other@test.dev', 'EG-333'))
      .expect(201);
  });

  it('an existing (social) patient account can become a doctor', async () => {
    const patient = await createPatient(ctx.prisma, { firstName: 'Karim' });
    const res = await ctx
      .api(patient.user)
      .post('/doctors/me/profile')
      .send({
        specialization: 'neurology',
        yearsOfExperience: 3,
        licenseNumber: 'EG-444',
      })
      .expect(201);
    expect(res.body.role).toBe(Role.DOCTOR);
    expect(res.body.doctorProfile.firstName).toBe('Karim');
    expect(res.body.patientProfile).not.toBeNull(); // kept

    await ctx
      .api(patient.user)
      .post('/doctors/me/profile')
      .send({
        specialization: 'neurology',
        yearsOfExperience: 3,
        licenseNumber: 'EG-445',
      })
      .expect(409);

    const mine = await ctx
      .api(patient.user)
      .patch('/doctors/me')
      .send({ bio: 'Headache clinic', yearsOfExperience: 4 })
      .expect(200);
    expect(mine.body).toMatchObject({
      bio: 'Headache clinic',
      yearsOfExperience: 4,
    });
  });

  it('admins suspend and reactivate doctors', async () => {
    const admin = await createAdmin(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma);
    const patient = await createPatient(ctx.prisma);
    const upcoming = await createAppointment(ctx.prisma, {
      patientId: patient.profile.id,
      doctorId: doctor.profile.id,
      status: AppointmentStatus.CONFIRMED,
    });

    await ctx
      .api(doctor.user)
      .patch(`/admin/doctors/${doctor.profile.id}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(403);

    const res = await ctx
      .api(admin)
      .patch(`/admin/doctors/${doctor.profile.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'License could not be confirmed.' })
      .expect(200);
    expect(res.body.cancelledAppointments).toBe(1);

    const appointment = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id: upcoming.id },
    });
    expect(appointment.status).toBe(AppointmentStatus.CANCELLED);
    await ctx.api().get(`/doctors/${doctor.profile.id}`).expect(404);
    await ctx
      .api(patient.user)
      .post('/appointments')
      .send({
        patientId: patient.profile.id,
        doctorId: doctor.profile.id,
        startTime: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      })
      .expect(404);

    const listed = await ctx
      .api(admin)
      .get('/admin/doctors?status=SUSPENDED')
      .expect(200);
    expect(listed.body.items.map((d: { id: number }) => d.id)).toContain(
      doctor.profile.id,
    );

    await ctx
      .api(admin)
      .patch(`/admin/doctors/${doctor.profile.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await ctx.api().get(`/doctors/${doctor.profile.id}`).expect(200);
  });

  it('exposes the specialization list and removes admin promotion', async () => {
    const res = await ctx.api().get('/doctors/specializations').expect(200);
    expect(res.body.items).toContain('cardiology');
    const admin = await createAdmin(ctx.prisma);
    await ctx.api(admin).post('/users/1/doctor-profile').send({}).expect(404);
  });
});
