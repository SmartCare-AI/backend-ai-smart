import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  AdminDoctorsController,
  DoctorsController,
} from './doctors.controller';
import { DoctorsService } from './doctors.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [DoctorsController, AdminDoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
