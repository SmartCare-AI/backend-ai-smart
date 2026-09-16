import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelemedicineController } from './telemedicine.controller';
import { TelemedicineService } from './telemedicine.service';

@Module({
  imports: [NotificationsModule],
  controllers: [TelemedicineController],
  providers: [TelemedicineService],
  exports: [TelemedicineService],
})
export class TelemedicineModule {}
