import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AssessmentsController } from './assessments.controller';
import { TestsController, VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [UsersModule],
  controllers: [VisitsController, TestsController, AssessmentsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
