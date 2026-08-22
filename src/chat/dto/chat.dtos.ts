import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateChatDto {
  @ApiProperty({
    example: 2,
    description:
      'User id (not profile id) of the other participant. Allowed pairs: doctor ↔ their patient, caregiver ↔ their patient.',
  })
  @IsInt()
  otherUserId!: number;

  @ApiPropertyOptional({ example: 1, description: 'Link this consultation to a visit.' })
  @IsOptional()
  @IsInt()
  visitId?: number;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Good morning doctor, my readings are attached.' })
  @ValidateIf((o: SendMessageDto) => !o.fileId)
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({ example: 3, description: 'Attachment file id (uploads module).' })
  @IsOptional()
  @IsInt()
  fileId?: number;
}

export class GetMessagesDto {
  @ApiPropertyOptional({
    example: 120,
    description: 'Return messages OLDER than this message id (infinite scroll).',
  })
  @IsOptional()
  @IsInt()
  cursor?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
