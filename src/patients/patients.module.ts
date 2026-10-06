import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
