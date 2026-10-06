import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { corsOrigin } from '../utils/cors.util';

/**
 * Socket.IO adapter that applies the same CORS rule as the REST API, so the
 * allow-list is configured once (CORS_ORIGINS) instead of hard-coded on the
 * gateway decorator.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origin: ReturnType<typeof corsOrigin>,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origin, credentials: true },
    } as ServerOptions);
  }
}
