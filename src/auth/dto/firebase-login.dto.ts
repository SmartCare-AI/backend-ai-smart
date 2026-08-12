import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class FirebaseLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjF...',
    description:
      'Firebase ID token obtained on the client after Google or Apple sign-in (firebase.auth().currentUser.getIdToken()).',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
