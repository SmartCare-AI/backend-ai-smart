import { Injectable, Logger } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';
import {
  AiProvider,
  TriageInput,
  TriageResult,
} from './ai-provider.interface';
import { RulesAiProvider } from './rules.provider';

/**
 * Client for our own Python ML service (FastAPI — see docs/AI-PLAN.md).
 * Selected by the module factory when AI_SERVICE_URL is set.
 *
 * Resilience: if the ML service is down, slow (>8s), or returns something
 * malformed, we degrade to the rules engine instead of failing the patient's
 * request — triage must always answer.
 */
@Injectable()
export class MlHttpAiProvider implements AiProvider {
  private readonly logger = new Logger(MlHttpAiProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly fallback: RulesAiProvider,
  ) {}

  async triage(input: TriageInput): Promise<TriageResult> {
    try {
      const response = await fetch(`${this.baseUrl}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`ML service responded ${response.status}`);
      }
      const body = (await response.json()) as Partial<TriageResult>;

      // Trust but verify — a bad model deploy must not corrupt triage.
      if (
        !body ||
        !Object.values(RiskLevel).includes(body.riskLevel as RiskLevel) ||
        typeof body.suggestedSpecialty !== 'string'
      ) {
        throw new Error('ML service returned a malformed triage result');
      }

      return {
        riskLevel: body.riskLevel as RiskLevel,
        suggestedSpecialty: body.suggestedSpecialty,
        seekEmergencyCare:
          body.seekEmergencyCare ?? body.riskLevel === RiskLevel.CRITICAL,
        redFlags: body.redFlags ?? [],
        reasons: body.reasons ?? [],
        advice:
          body.advice ??
          'This is an assistive assessment, not a diagnosis — a doctor will evaluate you.',
        engine: 'ml-service',
      };
    } catch (err) {
      this.logger.warn(
        `ML service unavailable (${(err as Error).message}) — using rules engine`,
      );
      const result = await this.fallback.triage(input);
      return { ...result, engine: 'rules-fallback' };
    }
  }
}
