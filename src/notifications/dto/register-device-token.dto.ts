import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    example: 'fcm-token-e5Jd93k...',
    description:
      'FCM registration token from the mobile/web app (messaging().getToken()).',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.ANDROID })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}

export class RemoveDeviceTokenDto {
  @ApiProperty({ example: 'fcm-token-e5Jd93k...' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
