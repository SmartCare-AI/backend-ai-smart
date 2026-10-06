import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SchedulerLockService } from './scheduler-lock.service';

@Global()
@Module({
  providers: [PrismaService, SchedulerLockService],
  exports: [PrismaService, SchedulerLockService],
})
export class PrismaModule {}
