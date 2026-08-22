import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Client metadata recorded on sessions (refresh tokens). */
export interface SessionMeta {
  /** Auto-sent by every HTTP client — identifies browser/app. */
  userAgent?: string;
  ip?: string;
  /** From the optional X-Platform header — informational only. */
  platform?: string;
}

/**
 * Extracts session metadata from the request without declaring the headers
 * as endpoint parameters — keeps Swagger clean (X-Platform is configured
 * once in the Authorize dialog instead; User-Agent is automatic).
 */
export const SessionMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionMeta => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return {
      userAgent: req.headers['user-agent'],
      platform: (req.headers['x-platform'] as string | undefined) ?? undefined,
      ip: req.ip,
    };
  },
);
