import {
  CareLinkStatus,
  ConsentStatus,
  NotificationType,
  Role,
} from '@prisma/client';
import {
  createDoctor,
  createPatient,
  createTestApp,
  TestContext,
} from './helpers';

describe('Phase 2 — Family Portal', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  /** Patient invites `email`; that person (a fresh account) accepts. */
  async function linkCaregiver(
    patient: Awaited<ReturnType<typeof createPatient>>,
    permissionLevel = 'RECEIVE_ALERTS',
  ) {
    const email = `family-${Date.now()}-${Math.random()}@test.dev`;
    const invite = await ctx
      .api(patient.user)
      .post('/caregivers/invite')
      .send({ email, relationship: 'daughter', permissionLevel })
      .expect(201);
    const member = await createPatient(ctx.prisma, {
      email,
      firstName: 'Mona',
    });
    const accepted = await ctx
      .api(member.user)
      .post(`/invitations/${invite.body.id}/accept`)
      .expect(200);
    const caregiverUser = { ...member.user, role: accepted.body.role as Role };
    const circle = await ctx
      .api(patient.user)
      .get('/caregivers/my')
      .expect(200);
    const link = (
      circle.body.caregivers as {
        id: number;
        caregiver: { user: { id: number } };
      }[]
    ).find((l) => l.caregiver.user.id === member.user.id)!;
    return { member, caregiverUser, linkId: link.id, accepted };
  }

  it('invite → accept → alerts reach the family → revoke cuts access', async () => {
    const patient = await createPatient(ctx.prisma, { firstName: 'Omar' });
    const email = 'mona.family@test.dev';

    const invite = await ctx
      .api(patient.user)
      .post('/caregivers/invite')
      .send({
        email: 'Mona.Family@test.dev',
        relationship: 'daughter',
        permissionLevel: 'FULL_ACCESS',
      })
      .expect(201);
    expect(invite.body).toMatchObject({ email, status: 'PENDING' });

    // The invitee creates an account with that email and sees the invitation.
    const member = await createPatient(ctx.prisma, {
      email,
      firstName: 'Mona',
    });
    const inbox = await ctx.api(member.user).get('/invitations/my').expect(200);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0].patient.firstName).toBe('Omar');

    const accepted = await ctx
      .api(member.user)
      .post(`/invitations/${invite.body.id}/accept`)
      .expect(200);
    expect(accepted.body.role).toBe(Role.CAREGIVER);
    expect(accepted.body.caregiverProfile.relationship).toBe('daughter');
    expect(accepted.body.patientProfile).not.toBeNull(); // kept
    const caregiver = { ...member.user, role: Role.CAREGIVER };

    const patients = await ctx
      .api(caregiver)
      .get('/caregivers/patients')
      .expect(200);
    expect(patients.body.items).toHaveLength(1);
    expect(patients.body.items[0]).toMatchObject({
      permissionLevel: 'FULL_ACCESS',
      patient: { id: patient.profile.id, firstName: 'Omar' },
    });

    // A real abnormal vital → alert → the caregiver is notified.
    await ctx
      .api(patient.user)
      .post('/vitals')
      .send({ type: 'HEART_RATE', value: 130, unit: 'bpm' })
      .expect(201);
    const notified = await ctx.prisma.notification.count({
      where: { userId: member.user.id, type: NotificationType.ALERT },
    });
    expect(notified).toBe(1);
    await ctx
      .api(caregiver)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(200);

    // The patient revokes: access stops on the next request.
    const linkId = patients.body.items[0].linkId;
    const removed = await ctx
      .api(patient.user)
      .delete(`/caregivers/${linkId}`)
      .expect(200);
    expect(removed.body.status).toBe('REVOKED');
    await ctx
      .api(caregiver)
      .get(`/vitals/patients/${patient.profile.id}`)
      .expect(403);
    const after = await ctx
      .api(caregiver)
      .get('/caregivers/patients')
      .expect(200);
    expect(after.body.items).toHaveLength(0);
  });

  it('enforces the companions limit and invitation rules', async () => {
    const patient = await createPatient(ctx.prisma);
    const send = (email: string) =>
      ctx
        .api(patient.user)
        .post('/caregivers/invite')
        .send({ email, relationship: 'son' });

    await send(patient.user.email).expect(400); // self
    await send('one@test.dev').expect(201);
    await send('one@test.dev').expect(409); // duplicate pending
    await send('two@test.dev').expect(201);
    await send('three@test.dev').expect(409); // circle full (2)

    const circle = await ctx
      .api(patient.user)
      .get('/caregivers/my')
      .expect(200);
    expect(circle.body.maxCompanions).toBe(2);
    const first = circle.body.pendingInvitations[0].id;
    await ctx
      .api(patient.user)
      .delete(`/caregivers/invitations/${first}`)
      .expect(200);
    await send('three@test.dev').expect(201); // room again
  });

  it('rejects expired invitations and other people’s invitations', async () => {
    const patient = await createPatient(ctx.prisma);
    const invite = await ctx
      .api(patient.user)
      .post('/caregivers/invite')
      .send({ email: 'late@test.dev', relationship: 'son' })
      .expect(201);
    const stranger = await createPatient(ctx.prisma);
    await ctx
      .api(stranger.user)
      .post(`/invitations/${invite.body.id}/accept`)
      .expect(404);

    await ctx.prisma.caregiverInvitation.update({
      where: { id: invite.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const late = await createPatient(ctx.prisma, { email: 'late@test.dev' });
    await ctx
      .api(late.user)
      .post(`/invitations/${invite.body.id}/accept`)
      .expect(400);
  });

  it('permission levels and extra consents decide what a caregiver may read', async () => {
    const patient = await createPatient(ctx.prisma);
    const { caregiverUser, linkId } = await linkCaregiver(
      patient,
      'RECEIVE_ALERTS',
    );
    const records = () =>
      ctx.api(caregiverUser).get(`/vitals/patients/${patient.profile.id}`);

    await records().expect(403); // alerts only

    const consent = await ctx
      .api(patient.user)
      .post('/consents')
      .send({ grantedToUserId: caregiverUser.id, type: 'VIEW_RECORDS' })
      .expect(201);
    await records().expect(200);
    const granted = await ctx.api(patient.user).get('/consents/my').expect(200);
    expect(granted.body.items[0]).toMatchObject({
      type: 'VIEW_RECORDS',
      status: 'ACTIVE',
    });

    await ctx
      .api(patient.user)
      .patch(`/consents/${consent.body.id}/revoke`)
      .expect(200);
    await records().expect(403);

    await ctx
      .api(patient.user)
      .patch(`/caregivers/${linkId}`)
      .send({ permissionLevel: 'VIEW_RECORDS' })
      .expect(200);
    await records().expect(200);

    // Consents only go to circle members.
    const outsider = await createPatient(ctx.prisma);
    await ctx
      .api(patient.user)
      .post('/consents')
      .send({ grantedToUserId: outsider.user.id, type: 'VIEW_RECORDS' })
      .expect(400);
  });

  it('a caregiver can leave; their extra consents are revoked', async () => {
    const patient = await createPatient(ctx.prisma);
    const { caregiverUser, linkId } = await linkCaregiver(patient);
    await ctx
      .api(patient.user)
      .post('/consents')
      .send({ grantedToUserId: caregiverUser.id, type: 'VIEW_RECORDS' })
      .expect(201);

    const left = await ctx
      .api(caregiverUser)
      .delete(`/caregivers/${linkId}`)
      .expect(200);
    expect(left.body.status).toBe('ENDED');
    const link = await ctx.prisma.patientCaregiver.findUniqueOrThrow({
      where: { id: linkId },
    });
    expect(link.status).toBe(CareLinkStatus.ENDED);
    const consents = await ctx.prisma.consent.findMany({
      where: { grantedToUserId: caregiverUser.id },
    });
    expect(consents.every((c) => c.status === ConsentStatus.REVOKED)).toBe(
      true,
    );
  });

  it('a doctor who accepts keeps the DOCTOR role', async () => {
    const patient = await createPatient(ctx.prisma);
    const doctor = await createDoctor(ctx.prisma);
    const invite = await ctx
      .api(patient.user)
      .post('/caregivers/invite')
      .send({ email: doctor.user.email, relationship: 'brother' })
      .expect(201);
    const res = await ctx
      .api(doctor.user)
      .post(`/invitations/${invite.body.id}/accept`)
      .expect(200);
    expect(res.body.role).toBe(Role.DOCTOR);
    expect(res.body.caregiverProfile).not.toBeNull();
  });
});
