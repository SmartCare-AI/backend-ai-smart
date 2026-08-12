import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'patient@example.com',
    description: 'If an account exists, a reset code is emailed to it.',
  })
  @IsEmail()
  email!: string;
}
