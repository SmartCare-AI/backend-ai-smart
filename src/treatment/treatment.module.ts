import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  MedicationsController,
  PrescriptionsController,
  TreatmentPlansController,
} from './treatment.controller';
import { TreatmentService } from './treatment.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [
    TreatmentPlansController,
    PrescriptionsController,
    MedicationsController,
  ],
  providers: [TreatmentService],
  exports: [TreatmentService],
})
export class TreatmentModule {}
