import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnlineVisitStatus, OnlineVisitType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateOnlineVisitDto {
  @ApiProperty({
    example: 1,
    description: 'Appointment this session belongs to (TR-001, BR-011).',
  })
  @IsInt()
  appointmentId!: number;

  @ApiPropertyOptional({
    enum: OnlineVisitType,
    default: OnlineVisitType.VIDEO,
  })
  @IsOptional()
  @IsEnum(OnlineVisitType)
  type?: OnlineVisitType;

  @ApiPropertyOptional({
    description:
      'Custom meeting link. Omit to let the platform generate a room URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLink?: string;

  @ApiPropertyOptional({ example: 'Follow-up on last week’s lab results.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class EndOnlineVisitDto {
  @ApiPropertyOptional({
    example: 'Patient reports improvement; continue plan.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListOnlineVisitsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OnlineVisitStatus })
  @IsOptional()
  @IsEnum(OnlineVisitStatus)
  status?: OnlineVisitStatus;
}
