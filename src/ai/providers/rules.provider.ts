import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';
import {
  AiProvider,
  TriageInput,
  TriageResult,
} from './ai-provider.interface';

/**
 * Built-in triage engine: explainable clinical rules, English + Arabic
 * keywords. This is the baseline the Python ML service must beat (and the
 * fallback when that service is down) — "clinical rules first, ML later".
 *
 * Deliberately simple: keyword matching over red flags and a
 * symptom → specialty map. Every output carries `reasons` so the app (and
 * the defense committee) can see exactly WHY a level was chosen.
 */

/** Presentations that warrant emergency care regardless of anything else. */
const RED_FLAGS: { label: string; keywords: string[] }[] = [
  {
    label: 'Chest pain',
    keywords: ['chest pain', 'chest tightness', 'pressure in chest', 'الم في الصدر', 'ألم في الصدر', 'ضيق في الصدر'],
  },
  {
    label: 'Difficulty breathing',
    keywords: ['can\'t breathe', 'cannot breathe', 'shortness of breath', 'difficulty breathing', 'ضيق تنفس', 'ضيق في التنفس', 'صعوبة في التنفس'],
  },
  {
    label: 'Severe bleeding',
    keywords: ['severe bleeding', 'bleeding a lot', 'blood loss', 'نزيف شديد', 'نزيف حاد'],
  },
  {
    label: 'Loss of consciousness',
    keywords: ['unconscious', 'fainted', 'passed out', 'اغمي', 'أغمي', 'فقدان الوعي', 'إغماء'],
  },
  {
    label: 'Possible stroke',
    keywords: ['face drooping', 'slurred speech', 'sudden numbness', 'numb on one side', 'تنميل مفاجئ', 'اعوجاج الوجه', 'تلعثم'],
  },
  {
    label: 'Seizure',
    keywords: ['seizure', 'convulsion', 'تشنج', 'نوبة صرع'],
  },
  {
    label: 'Coughing blood',
    keywords: ['coughing blood', 'coughing up blood', 'vomiting blood', 'كحة بدم', 'قيء دم', 'سعال بدم'],
  },
  {
    label: 'Severe allergic reaction',
    keywords: ['anaphylaxis', 'throat swelling', 'swollen throat', 'severe allergic', 'حساسية شديدة', 'تورم الحلق'],
  },
  {
    label: 'Suicidal thoughts',
    keywords: ['suicidal', 'want to die', 'kill myself', 'انتحار', 'اريد ان اموت', 'أريد أن أموت'],
  },
];

/** First match wins — order roughly by specificity. */
const SPECIALTY_RULES: { specialty: string; keywords: string[] }[] = [
  { specialty: 'cardiology', keywords: ['chest', 'heart', 'palpitation', 'قلب', 'صدر', 'خفقان'] },
  { specialty: 'pulmonology', keywords: ['breath', 'cough', 'wheez', 'asthma', 'تنفس', 'كحة', 'سعال', 'ربو'] },
  { specialty: 'neurology', keywords: ['headache', 'migraine', 'dizz', 'numb', 'seizure', 'memory', 'صداع', 'دوخة', 'دوار', 'تنميل', 'شقيقة'] },
  { specialty: 'gastroenterology', keywords: ['stomach', 'abdom', 'nausea', 'vomit', 'diarrhea', 'constipation', 'heartburn', 'معدة', 'بطن', 'غثيان', 'قيء', 'اسهال', 'إسهال', 'امساك', 'إمساك', 'حرقان'] },
  { specialty: 'dermatology', keywords: ['rash', 'skin', 'itch', 'acne', 'eczema', 'جلد', 'طفح', 'حكة', 'حبوب'] },
  { specialty: 'orthopedics', keywords: ['joint', 'knee', 'back pain', 'bone', 'fracture', 'shoulder', 'مفصل', 'ركبة', 'ظهر', 'عظم', 'كسر', 'كتف'] },
  { specialty: 'urology', keywords: ['urin', 'kidney', 'bladder', 'بول', 'كلى', 'مثانة'] },
  { specialty: 'ophthalmology', keywords: ['eye', 'vision', 'blurry', 'عين', 'نظر', 'رؤية'] },
  { specialty: 'otolaryngology', keywords: ['ear', 'throat', 'sinus', 'nose', 'اذن', 'أذن', 'حلق', 'جيوب', 'انف', 'أنف'] },
  { specialty: 'endocrinology', keywords: ['diabetes', 'thyroid', 'blood sugar', 'سكر', 'سكري', 'غدة'] },
  { specialty: 'psychiatry', keywords: ['anxiety', 'depress', 'panic', 'قلق', 'اكتئاب', 'توتر'] },
];

const SEVERE_WORDS = ['severe', 'unbearable', 'worst', 'extreme', 'شديد', 'لا يحتمل', 'قوي جدا'];

const RISK_ORDER: RiskLevel[] = [
  RiskLevel.LOW,
  RiskLevel.MODERATE,
  RiskLevel.HIGH,
  RiskLevel.CRITICAL,
];

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

@Injectable()
export class RulesAiProvider implements AiProvider {
  triage(input: TriageInput): Promise<TriageResult> {
    // One lowercase haystack of everything the patient reported.
    const text = [
      ...input.symptoms.map((s) => `${s.name} ${s.severity ?? ''}`),
      input.notes ?? '',
    ]
      .join(' \n ')
      .toLowerCase();

    const reasons: string[] = [];

    // 1. Red flags → CRITICAL, tell them to seek emergency care first.
    const redFlags = RED_FLAGS.filter((flag) =>
      flag.keywords.some((k) => text.includes(k)),
    ).map((flag) => flag.label);

    let risk: RiskLevel = RiskLevel.LOW;
    if (redFlags.length > 0) {
      risk = RiskLevel.CRITICAL;
      reasons.push(`Red-flag symptoms reported: ${redFlags.join(', ')}.`);
    }

    // 2. Reported intensity.
    if (SEVERE_WORDS.some((w) => text.includes(w))) {
      risk = maxRisk(risk, RiskLevel.HIGH);
      reasons.push('Symptoms described as severe.');
    }

    // 3. Breadth: many simultaneous symptoms.
    if (input.symptoms.length >= 3) {
      risk = maxRisk(risk, RiskLevel.MODERATE);
      reasons.push(`${input.symptoms.length} symptoms reported at once.`);
    }

    // 4. Vulnerability: age or chronic conditions raise the floor.
    if (input.age !== null && (input.age >= 65 || input.age <= 5)) {
      risk = maxRisk(risk, RiskLevel.MODERATE);
      reasons.push(`Patient age (${input.age}) is a vulnerable group.`);
    }
    if (input.chronicDiseases?.trim()) {
      risk = maxRisk(risk, RiskLevel.MODERATE);
      reasons.push('Chronic conditions on record.');
    }

    if (reasons.length === 0) {
      reasons.push('No red flags, severe descriptors, or risk factors matched.');
    }

    // 5. Specialty: first rule whose keyword appears; internal medicine
    //    is the safe default for an unclear picture.
    const match = SPECIALTY_RULES.find((rule) =>
      rule.keywords.some((k) => text.includes(k)),
    );
    const specialty = match?.specialty ?? 'internal medicine';

    const seekEmergencyCare = risk === RiskLevel.CRITICAL;
    const advice = seekEmergencyCare
      ? 'Your symptoms may be serious. Call emergency services (123 in Egypt) or press the SOS button now.'
      : risk === RiskLevel.HIGH
        ? `Please book an appointment as soon as possible — we suggest the ${specialty} department.`
        : `Your answers suggest the ${specialty} department. This is an assistive assessment, not a diagnosis — a doctor will evaluate you.`;

    return Promise.resolve({
      riskLevel: risk,
      suggestedSpecialty: specialty,
      seekEmergencyCare,
      redFlags,
      reasons,
      advice,
      engine: 'rules',
    });
  }
}
