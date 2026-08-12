import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from '../../users/entities/user.entity';

export class AuthResponseEntity {
  @ApiProperty({ type: UserEntity })
  user!: UserEntity;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived JWT. Send as "Authorization: Bearer <token>".',
  })
  accessToken!: string;

  @ApiProperty({
    example: '9a1f0e3b6c...64-char-hex-token...d7c2',
    description:
      'Long-lived opaque token. Exchange it at POST /auth/refresh for a new pair (single use — it is rotated).',
  })
  refreshToken!: string;
}
