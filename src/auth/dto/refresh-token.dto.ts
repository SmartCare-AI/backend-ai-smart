import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: '9a1f0e3b6c...64-char-hex-token...d7c2',
    description: 'The refresh token returned at login.',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
