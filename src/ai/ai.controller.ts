import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AiService } from './ai.service';
import { TriageRequestDto } from './dto/ai.dtos';

@ApiTags('AI')
@ApiBearerAuth('access-token')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('triage')
  @Roles(Role.PATIENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Symptom triage — assistive risk level + suggested specialty',
    description:
      'The patient describes symptoms (Arabic or English); the engine returns a risk level, ' +
      'the most relevant specialty, red-flag warnings, and the reasoning behind them. ' +
      'The result is saved as an AI_INITIAL Assessment visible to the treating doctor. ' +
      '**Assistive only — never a diagnosis.** Backed by an explainable rules engine today; ' +
      'the trained ML service (AI_SERVICE_URL) plugs into the same endpoint later.',
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        assessmentId: 12,
        riskLevel: 'MODERATE',
        suggestedSpecialty: 'neurology',
        seekEmergencyCare: false,
        redFlags: [],
        reasons: ['2 symptoms reported at once.', 'Chronic conditions on record.'],
        advice:
          'Your answers suggest the neurology department. This is an assistive assessment, not a diagnosis — a doctor will evaluate you.',
        engine: 'rules',
        disclaimer:
          'Assistive assessment only — not a medical diagnosis. Always consult a doctor.',
      },
    },
  })
  triage(@CurrentUser() user: AuthenticatedUser, @Body() dto: TriageRequestDto) {
    return this.aiService.triage(user, dto);
  }

  @Get('patients/:patientId/risk')
  @ApiOperation({
    summary: "A patient's live risk snapshot (deterministic, explainable)",
    description:
      'Combines the latest vitals vs clinical thresholds, active alerts, 30-day medication ' +
      'adherence, and open emergencies into one risk level with the full list of contributing ' +
      'factors. Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        patientId: 3,
        riskLevel: 'HIGH',
        factors: [
          { severity: 'HIGH', reason: 'HEART_RATE is 125 bpm (above 120).' },
          {
            severity: 'MODERATE',
            reason: 'Medication adherence is low (42% over 30 days).',
          },
        ],
        adherenceScore: 0.42,
        computedAt: '2026-08-22T14:05:00.000Z',
      },
    },
  })
  risk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
  ) {
    return this.aiService.risk(user, patientId);
  }
}
