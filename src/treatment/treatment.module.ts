import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { MedicationSchedulerService } from './medication-scheduler.service';
import {
  MedicationsController,
  PrescriptionsController,
  TreatmentPlansController,
} from './treatment.controller';
import { TreatmentService } from './treatment.service';

@Module({
  imports: [UsersModule, NotificationsModule, AlertsModule],
  controllers: [
    TreatmentPlansController,
    PrescriptionsController,
    MedicationsController,
  ],
  providers: [TreatmentService, MedicationSchedulerService],
  exports: [TreatmentService],
})
export class TreatmentModule {}
