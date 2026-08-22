import { RiskLevel, VitalType } from '@prisma/client';

interface ThresholdRule {
  /** Alert when value is ABOVE this */
  max?: number;
  /** Alert when value is BELOW this */
  min?: number;
  severity: RiskLevel;
}

/**
 * Clinical threshold rules — deliberately simple and explainable
 * ("clinical rules first, ML later", File.md Phase F). Rules are checked
 * in order; the FIRST match wins, so CRITICAL bounds come first.
 * Units: bpm, mg/dL, %, mmHg, °C.
 */
const THRESHOLDS: Partial<Record<VitalType, ThresholdRule[]>> = {
  [VitalType.HEART_RATE]: [
    { max: 140, severity: RiskLevel.CRITICAL },
    { min: 40, severity: RiskLevel.CRITICAL },
    { max: 120, severity: RiskLevel.HIGH },
    { min: 50, severity: RiskLevel.HIGH },
  ],
  [VitalType.BLOOD_SUGAR]: [
    { max: 300, severity: RiskLevel.CRITICAL },
    { min: 54, severity: RiskLevel.CRITICAL },
    { max: 180, severity: RiskLevel.HIGH },
    { min: 70, severity: RiskLevel.HIGH },
  ],
  [VitalType.OXYGEN_SATURATION]: [
    { min: 90, severity: RiskLevel.CRITICAL },
    { min: 94, severity: RiskLevel.HIGH },
  ],
  [VitalType.BLOOD_PRESSURE_SYSTOLIC]: [
    { max: 180, severity: RiskLevel.CRITICAL },
    { max: 140, severity: RiskLevel.HIGH },
    { min: 90, severity: RiskLevel.HIGH },
  ],
  [VitalType.BLOOD_PRESSURE_DIASTOLIC]: [
    { max: 120, severity: RiskLevel.CRITICAL },
    { max: 90, severity: RiskLevel.HIGH },
  ],
  [VitalType.TEMPERATURE]: [
    { max: 39.5, severity: RiskLevel.CRITICAL },
    { min: 35, severity: RiskLevel.CRITICAL },
    { max: 38, severity: RiskLevel.HIGH },
  ],
};

export interface ThresholdViolation {
  severity: RiskLevel;
  bound: string; // human text, e.g. "above 140"
}

export function evaluateVital(
  type: VitalType,
  value: number,
): ThresholdViolation | null {
  const rules = THRESHOLDS[type];
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.max !== undefined && value > rule.max) {
      return { severity: rule.severity, bound: `above ${rule.max}` };
    }
    if (rule.min !== undefined && value < rule.min) {
      return { severity: rule.severity, bound: `below ${rule.min}` };
    }
  }
  return null;
}
