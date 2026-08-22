/**
 * Seed data — idempotent (safe to run repeatedly): npm run db:seed
 * Creates the shared demo world every teammate and every defense demo uses.
 *
 * Accounts (password for all: Demo1234):
 *   admin@smartcare.dev    ADMIN
 *   doctor@smartcare.dev   DOCTOR (Cardiology, SmartCare Hospital)
 *   patient@smartcare.dev  PATIENT (MRN auto)
 *   family@smartcare.dev   CAREGIVER (linked to the patient, FULL_ACCESS)
 */
import { PrismaClient, Role, ConsentType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(email: string, role: Role, firstName: string, lastName: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: passwordHash,
      firstName,
      lastName,
      role,
      isEmailVerified: true,
    },
  });
}

async function main() {
  const password = await bcrypt.hash('Demo1234', 12);

  // --- Users -----------------------------------------------------------------
  const admin = await upsertUser('admin@smartcare.dev', Role.ADMIN, 'Sara', 'Admin', password);
  const doctorUser = await upsertUser('doctor@smartcare.dev', Role.DOCTOR, 'Ahmed', 'Hassan', password);
  const patientUser = await upsertUser('patient@smartcare.dev', Role.PATIENT, 'Omar', 'Youssef', password);
  const caregiverUser = await upsertUser('family@smartcare.dev', Role.CAREGIVER, 'Mona', 'Youssef', password);

  // --- Hospital & departments ------------------------------------------------
  let hospital = await prisma.hospital.findFirst({ where: { name: 'SmartCare Hospital' } });
  if (!hospital) {
    hospital = await prisma.hospital.create({
      data: {
        name: 'SmartCare Hospital',
        type: 'general',
        address: 'Cairo, Egypt',
        phone: '+20223456789',
        email: 'info@smartcare.dev',
      },
    });
  }
  const cardiology = await prisma.department.upsert({
    where: { hospitalId_name: { hospitalId: hospital.id, name: 'Cardiology' } },
    update: {},
    create: { hospitalId: hospital.id, name: 'Cardiology', description: 'Heart care unit' },
  });
  await prisma.department.upsert({
    where: { hospitalId_name: { hospitalId: hospital.id, name: 'Internal Medicine' } },
    update: {},
    create: { hospitalId: hospital.id, name: 'Internal Medicine' },
  });

  // --- Profiles ----------------------------------------------------------------
  await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      licenseNumber: 'EG-MED-100001',
      specialization: 'Cardiology',
      yearsOfExperience: 12,
      bio: 'Consultant cardiologist.',
      hospitalId: hospital.id,
      departmentId: cardiology.id,
      isVerified: true,
    },
  });

  const patientProfile = await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      medicalRecordNo: `SC-${new Date().getFullYear()}-${String(patientUser.id).padStart(6, '0')}`,
      chronicDiseases: 'Type 2 diabetes',
      allergies: 'Penicillin',
    },
  });

  const caregiverProfile = await prisma.caregiverProfile.upsert({
    where: { userId: caregiverUser.id },
    update: {},
    create: { userId: caregiverUser.id, relationship: 'spouse' },
  });

  await prisma.patientCaregiver.upsert({
    where: {
      patientId_caregiverId: {
        patientId: patientProfile.id,
        caregiverId: caregiverProfile.id,
      },
    },
    update: {},
    create: {
      patientId: patientProfile.id,
      caregiverId: caregiverProfile.id,
      permission: ConsentType.FULL_ACCESS,
    },
  });

  await prisma.emergencyContact.deleteMany({ where: { patientId: patientProfile.id } });
  await prisma.emergencyContact.create({
    data: {
      patientId: patientProfile.id,
      name: 'Mostafa Youssef',
      phone: '+201001112223',
      relationship: 'brother',
      priority: 1,
    },
  });

  // --- First-aid guides (Emergency Hub content) --------------------------------
  const guides: Array<{ slug: string; title: string; category: string; content: string }> = [
    {
      slug: 'severe-bleeding',
      title: 'Severe Bleeding',
      category: 'bleeding',
      content: '## Severe Bleeding\n1. **Call emergency services (123 in Egypt).**\n2. Apply firm, direct pressure with a clean cloth.\n3. Do NOT remove soaked cloths — add more layers on top.\n4. If a limb, raise it above heart level.\n5. Keep pressing until help arrives.',
    },
    {
      slug: 'burns',
      title: 'Burns',
      category: 'burns',
      content: '## Burns\n1. Cool the burn under cool running water for **20 minutes**.\n2. Remove rings/watches near the area before swelling.\n3. Cover loosely with cling film or a clean cloth.\n4. Do NOT apply ice, toothpaste, or butter.\n5. Seek medical care for large, deep, face, or hand burns.',
    },
    {
      slug: 'choking-adult',
      title: 'Choking (Adult)',
      category: 'choking',
      content: '## Choking — Adult\n1. Ask: "Are you choking?" If they can cough, encourage coughing.\n2. If silent: give **5 back blows** between shoulder blades.\n3. Then **5 abdominal thrusts** (Heimlich).\n4. Alternate 5 and 5 until the object clears.\n5. If they collapse, start CPR and call emergency services.',
    },
    {
      slug: 'cpr-adult',
      title: 'CPR (Adult)',
      category: 'cpr',
      content: '## CPR — Adult\n1. Check response and breathing; call emergency services.\n2. Place hands in the center of the chest.\n3. Push hard and fast: **100–120 compressions/min**, 5–6 cm deep.\n4. Let the chest fully rise between compressions.\n5. Continue until help or an AED arrives. Untrained? Hands-only CPR.',
    },
    {
      slug: 'fractures',
      title: 'Suspected Fracture',
      category: 'fractures',
      content: '## Suspected Fracture\n1. Do NOT move the limb or try to straighten it.\n2. Immobilize with a splint/padding in the position found.\n3. Apply a cold pack wrapped in cloth (max 20 min).\n4. Treat for shock: lay flat, keep warm.\n5. Get medical help; do not let the person eat or drink.',
    },
  ];
  for (const g of guides) {
    await prisma.firstAidGuide.upsert({
      where: { slug: g.slug },
      update: { content: g.content, title: g.title, category: g.category, isPublished: true },
      create: { ...g, isPublished: true },
    });
  }

  console.log('Seed complete:');
  console.log(`  admin:     admin@smartcare.dev / Demo1234`);
  console.log(`  doctor:    doctor@smartcare.dev / Demo1234`);
  console.log(`  patient:   patient@smartcare.dev / Demo1234 (MRN ${patientProfile.medicalRecordNo})`);
  console.log(`  caregiver: family@smartcare.dev / Demo1234 (FULL_ACCESS to patient)`);
  console.log(`  hospital:  ${hospital.name} (+2 departments), ${guides.length} first-aid guides`);
  void admin;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
