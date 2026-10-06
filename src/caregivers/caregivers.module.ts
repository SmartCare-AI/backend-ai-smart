import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  CaregiversController,
  ConsentsController,
  InvitationsController,
} from './caregivers.controller';
import { CaregiversService } from './caregivers.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [
    CaregiversController,
    InvitationsController,
    ConsentsController,
  ],
  providers: [CaregiversService],
})
export class CaregiversModule {}
