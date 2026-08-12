import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class AppController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check (liveness probe)' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'smartcare-api' },
    },
  })
  health() {
    return { status: 'ok', service: 'smartcare-api' };
  }
}
