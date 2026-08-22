import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TreatmentModule } from '../treatment/treatment.module';
import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { MlHttpAiProvider } from './providers/ml-http.provider';
import { RulesAiProvider } from './providers/rules.provider';

@Module({
  imports: [UsersModule, TreatmentModule],
  controllers: [AiController],
  providers: [
    AiService,
    RulesAiProvider,
    {
      // Strategy selection: our Python ML service when AI_SERVICE_URL is
      // set (with rules fallback inside), pure rules engine otherwise.
      provide: AI_PROVIDER,
      inject: [ConfigService, RulesAiProvider],
      useFactory: (config: ConfigService, rules: RulesAiProvider) => {
        const url = config.get<string>('AI_SERVICE_URL');
        return url
          ? new MlHttpAiProvider(url.replace(/\/$/, ''), rules)
          : rules;
      },
    },
  ],
})
export class AiModule {}
