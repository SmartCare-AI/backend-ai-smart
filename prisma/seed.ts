/**
 * Seed data — idempotent (safe to run repeatedly): npm run db:seed
 * Creates the shared demo world every teammate and every defense demo uses.
 *
 * Accounts (password for all: Demo1234):
 *   admin@shifaa.dev    ADMIN
 *   doctor@shifaa.dev   DOCTOR (Cardiology, SHIFAA Hospital)
 *   patient@shifaa.dev  PATIENT (MRN auto)
 *   family@shifaa.dev   CAREGIVER (linked to the patient, FULL_ACCESS)
 *
 * Personal names live on the role profiles, per the ERD's User/Profile
 * separation — the User row only carries account data.
 */
import {
  BloodType,
  ConsentType,
  Gender,
  HospitalType,
  MedicineForm,
  PrismaClient,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(
  email: string,
  role: Role,
  passwordHash: string,
  phone?: string,
) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: passwordHash,
      role,
      phone: phone ?? null,
      isEmailVerified: true,
    },
  });
}

async function main() {
  const password = await bcrypt.hash('Demo1234', 12);

  // --- Accounts --------------------------------------------------------------
  const admin = await upsertUser('admin@shifaa.dev', Role.ADMIN, password);
  const doctorUser = await upsertUser(
    'doctor@shifaa.dev',
    Role.DOCTOR,
    password,
    '+201001110001',
  );
  const patientUser = await upsertUser(
    'patient@shifaa.dev',
    Role.PATIENT,
    password,
    '+201001110002',
  );
  const caregiverUser = await upsertUser(
    'family@shifaa.dev',
    Role.CAREGIVER,
    password,
    '+201001110003',
  );

  // --- Hospital & departments ------------------------------------------------
  let hospital = await prisma.hospital.findFirst({
    where: { name: 'SHIFAA Hospital' },
  });
  if (!hospital) {
    hospital = await prisma.hospital.create({
      data: {
        name: 'SHIFAA Hospital',
        type: HospitalType.GENERAL,
        address: 'Cairo, Egypt',
        phone: '+20223456789',
        email: 'info@shifaa.dev',
      },
    });
  }
  const cardiology = await prisma.department.upsert({
    where: { hospitalId_name: { hospitalId: hospital.id, name: 'Cardiology' } },
    update: {},
    create: {
      hospitalId: hospital.id,
      name: 'Cardiology',
      description: 'Heart care unit',
    },
  });
  await prisma.department.upsert({
    where: {
      hospitalId_name: { hospitalId: hospital.id, name: 'Internal Medicine' },
    },
    update: {},
    create: { hospitalId: hospital.id, name: 'Internal Medicine' },
  });

  // --- Profiles (ERD #2 / #3 / #4) -------------------------------------------
  await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      firstName: 'Ahmed',
      lastName: 'Hassan',
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
      firstName: 'Omar',
      lastName: 'Youssef',
      medicalRecordNo: `SH-${new Date().getFullYear()}-${String(patientUser.id).padStart(6, '0')}`,
      dateOfBirth: new Date('1985-03-21T00:00:00.000Z'),
      gender: Gender.MALE,
      bloodType: BloodType.O_POS,
      address: 'Nasr City, Cairo',
      emergencyContact: 'Mona Youssef',
      emergencyPhone: '+201001110003',
      chronicDiseases: 'Type 2 diabetes',
      allergies: 'Penicillin',
    },
  });

  const caregiverProfile = await prisma.caregiverProfile.upsert({
    where: { userId: caregiverUser.id },
    update: {},
    create: {
      userId: caregiverUser.id,
      firstName: 'Mona',
      lastName: 'Youssef',
      relationship: 'spouse',
      address: 'Nasr City, Cairo',
    },
  });

  // --- Care relationship (ERD #7) --------------------------------------------
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
      permissionLevel: ConsentType.FULL_ACCESS,
    },
  });

  await prisma.emergencyContact.deleteMany({
    where: { patientId: patientProfile.id },
  });
  await prisma.emergencyContact.create({
    data: {
      patientId: patientProfile.id,
      name: 'Mostafa Youssef',
      phone: '+201001112223',
      relationship: 'brother',
      priority: 1,
    },
  });

  // --- Medicine catalog (ERD #19) --------------------------------------------
  const medicines: Array<{
    name: string;
    genericName: string;
    form: MedicineForm;
    strength: string;
    description: string;
  }> = [
    {
      name: 'Metformin',
      genericName: 'Metformin hydrochloride',
      form: MedicineForm.TABLET,
      strength: '500mg',
      description: 'Oral antidiabetic, first-line for type 2 diabetes.',
    },
    {
      name: 'Amlodipine',
      genericName: 'Amlodipine besylate',
      form: MedicineForm.TABLET,
      strength: '5mg',
      description: 'Calcium channel blocker for hypertension.',
    },
    {
      name: 'Atorvastatin',
      genericName: 'Atorvastatin calcium',
      form: MedicineForm.TABLET,
      strength: '20mg',
      description: 'Statin for lipid control.',
    },
    {
      name: 'Salbutamol',
      genericName: 'Albuterol',
      form: MedicineForm.INHALER,
      strength: '100mcg/dose',
      description: 'Short-acting bronchodilator.',
    },
    {
      name: 'Paracetamol',
      genericName: 'Acetaminophen',
      form: MedicineForm.SYRUP,
      strength: '120mg/5ml',
      description: 'Analgesic and antipyretic.',
    },
  ];
  for (const medicine of medicines) {
    await prisma.medicine.upsert({
      where: {
        name_form_strength: {
          name: medicine.name,
          form: medicine.form,
          strength: medicine.strength,
        },
      },
      update: {
        genericName: medicine.genericName,
        description: medicine.description,
      },
      create: medicine,
    });
  }

  // --- First-aid guides (Emergency Hub content) --------------------------------
  const guides: Array<{
    slug: string;
    title: string;
    category: string;
    content: string;
  }> = [
    {
      slug: 'severe-bleeding',
      title: 'Severe Bleeding',
      category: 'bleeding',
      content:
        '## Severe Bleeding\n1. **Call emergency services (123 in Egypt).**\n2. Apply firm, direct pressure with a clean cloth.\n3. Do NOT remove soaked cloths — add more layers on top.\n4. If a limb, raise it above heart level.\n5. Keep pressing until help arrives.',
    },
    {
      slug: 'burns',
      title: 'Burns',
      category: 'burns',
      content:
        '## Burns\n1. Cool the burn under cool running water for **20 minutes**.\n2. Remove rings/watches near the area before swelling.\n3. Cover loosely with cling film or a clean cloth.\n4. Do NOT apply ice, toothpaste, or butter.\n5. Seek medical care for large, deep, face, or hand burns.',
    },
    {
      slug: 'choking-adult',
      title: 'Choking (Adult)',
      category: 'choking',
      content:
        '## Choking — Adult\n1. Ask: "Are you choking?" If they can cough, encourage coughing.\n2. If silent: give **5 back blows** between shoulder blades.\n3. Then **5 abdominal thrusts** (Heimlich).\n4. Alternate 5 and 5 until the object clears.\n5. If they collapse, start CPR and call emergency services.',
    },
    {
      slug: 'cpr-adult',
      title: 'CPR (Adult)',
      category: 'cpr',
      content:
        '## CPR — Adult\n1. Check response and breathing; call emergency services.\n2. Place hands in the center of the chest.\n3. Push hard and fast: **100–120 compressions/min**, 5–6 cm deep.\n4. Let the chest fully rise between compressions.\n5. Continue until help or an AED arrives. Untrained? Hands-only CPR.',
    },
    {
      slug: 'fractures',
      title: 'Suspected Fracture',
      category: 'fractures',
      content:
        '## Suspected Fracture\n1. Do NOT move the limb or try to straighten it.\n2. Immobilize with a splint/padding in the position found.\n3. Apply a cold pack wrapped in cloth (max 20 min).\n4. Treat for shock: lay flat, keep warm.\n5. Get medical help; do not let the person eat or drink.',
    },
  ];
  for (const g of guides) {
    await prisma.firstAidGuide.upsert({
      where: { slug: g.slug },
      update: {
        content: g.content,
        title: g.title,
        category: g.category,
        isPublished: true,
      },
      create: { ...g, isPublished: true },
    });
  }

  console.log('Seed complete:');
  console.log('  admin:     admin@shifaa.dev / Demo1234');
  console.log('  doctor:    doctor@shifaa.dev / Demo1234 (Dr. Ahmed Hassan)');
  console.log(
    `  patient:   patient@shifaa.dev / Demo1234 (Omar Youssef, MRN ${patientProfile.medicalRecordNo})`,
  );
  console.log(
    '  caregiver: family@shifaa.dev / Demo1234 (Mona Youssef, FULL_ACCESS)',
  );
  console.log(
    `  hospital:  ${hospital.name} (+2 departments), ${medicines.length} medicines, ${guides.length} first-aid guides`,
  );
  void admin;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
