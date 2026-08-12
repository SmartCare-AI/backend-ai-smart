import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'patient@example.com',
    description: 'A verification code will be sent to this address.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'P@ssw0rd123',
    minLength: 8,
    description:
      'Min 8 characters, must contain at least one letter and one number.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({ example: 'Omar' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName!: string;

  @ApiProperty({ example: 'Hassan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName!: string;

  @ApiPropertyOptional({
    example: '+201001234567',
    description: 'E.164 format with country code.',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'phone must be a valid number in E.164 format (e.g. +2010...)',
  })
  phone?: string;
}
