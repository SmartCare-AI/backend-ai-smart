import { RiskLevel } from '@prisma/client';

/**
 * Triage engine abstraction (Strategy pattern — same shape as StorageProvider
 * and SmsProvider). The API depends on this interface, never on how the
 * answer is produced. Today: a built-in explainable rules engine. Later: our
 * own Python ML service (see docs/AI-PLAN.md) — a config change, not a
 * code change.
 */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface TriageSymptom {
  name: string;
  /** e.g. "3 days" */
  duration?: string | null;
  /** mild | moderate | severe */
  severity?: string | null;
}

export interface TriageInput {
  /** Years, when date of birth is on record */
  age: number | null;
  gender: string | null;
  /** Free-text medical background from the patient profile */
  chronicDiseases: string | null;
  symptoms: TriageSymptom[];
  /** Anything else the patient wrote */
  notes?: string | null;
}

export interface TriageResult {
  riskLevel: RiskLevel;
  /** English lowercase, e.g. "cardiology" — assistive referral, NOT a diagnosis */
  suggestedSpecialty: string;
  /** True when the picture sounds life-threatening → app shows the SOS card */
  seekEmergencyCare: boolean;
  /** Red-flag phrases that were matched, shown to the patient as warnings */
  redFlags: string[];
  /** Human-readable explanation of how the risk level was reached */
  reasons: string[];
  /** Short non-diagnostic guidance for the patient */
  advice: string;
  /** Which engine produced this: "rules" | "ml-service" | "rules-fallback" */
  engine: string;
}

export interface AiProvider {
  /** Assistive risk assessment + specialty suggestion. Never diagnostic. */
  triage(input: TriageInput): Promise<TriageResult>;
}
