import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AssessmentsController } from './assessments.controller';
import {
  DiagnosesController,
  TestsController,
  VisitsController,
} from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [UsersModule],
  controllers: [
    VisitsController,
    DiagnosesController,
    TestsController,
    AssessmentsController,
  ],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
