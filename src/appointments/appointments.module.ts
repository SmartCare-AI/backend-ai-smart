import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelemedicineModule } from '../telemedicine/telemedicine.module';
import { UsersModule } from '../users/users.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [UsersModule, NotificationsModule, TelemedicineModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
