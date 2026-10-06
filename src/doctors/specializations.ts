/**
 * The fixed specialization vocabulary. Stored lowercase on
 * DoctorProfile.specialization and IDENTICAL to the `suggestedSpecialty`
 * values produced by AI triage (rules engine and smartcare-ml), so a triage
 * result can be passed straight to `GET /doctors?specialization=`.
 *
 * Display labels (English/Arabic) live in the apps; the API only speaks keys.
 */
export const SPECIALIZATIONS = [
  'internal medicine',
  'family medicine',
  'cardiology',
  'pulmonology',
  'neurology',
  'gastroenterology',
  'endocrinology',
  'nephrology',
  'rheumatology',
  'hematology',
  'oncology',
  'infectious disease',
  'allergy and immunology',
  'dermatology',
  'orthopedics',
  'urology',
  'ophthalmology',
  'otolaryngology',
  'psychiatry',
  'pediatrics',
  'obstetrics and gynecology',
  'general surgery',
  'emergency medicine',
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];
