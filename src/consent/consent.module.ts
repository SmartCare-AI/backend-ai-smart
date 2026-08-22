import { Global, Module } from '@nestjs/common';
import { ConsentService } from './consent.service';

@Global()
@Module({
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
