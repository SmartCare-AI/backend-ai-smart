import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'patient@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '482913',
    description: '6-digit code received by email.',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @ApiProperty({
    example: 'N3wP@ssw0rd',
    minLength: 8,
    description:
      'Min 8 characters, must contain at least one letter and one number.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword!: string;
}
