import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ProfilesService } from './profiles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [UploadsModule],
  controllers: [UsersController],
  providers: [UsersService, ProfilesService],
  exports: [UsersService, ProfilesService],
})
export class UsersModule {}
