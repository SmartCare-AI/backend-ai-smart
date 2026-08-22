import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from './audit.service';

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// High-noise or sensitive routes we deliberately keep out of the trail.
const SKIPPED_PATHS = ['/auth/refresh', '/health'];

// Auth actions get semantic names instead of raw HTTP verbs.
const ACTION_OVERRIDES: Record<string, string> = {
  '/auth/login': 'LOGIN',
  '/auth/register': 'REGISTER',
  '/auth/social/firebase': 'LOGIN',
  '/auth/logout': 'LOGOUT',
  '/auth/verify-email': 'VERIFY_EMAIL',
  '/auth/reset-password': 'RESET_PASSWORD',
};

const METHOD_ACTIONS: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

/**
 * Registered globally: records every successful mutating request in the
 * audit log. Request/response BODIES are intentionally never stored —
 * medical data and passwords must not leak into logs.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    if (!AUDITED_METHODS.has(req.method)) return next.handle();

    const path = req.originalUrl.split('?')[0].replace(/^\/api\/v1/, '');
    if (SKIPPED_PATHS.some((p) => path.startsWith(p))) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const segments = path.split('/').filter(Boolean);
        this.audit.record({
          userId: req.user?.id ?? null,
          action: ACTION_OVERRIDES[path] ?? METHOD_ACTIONS[req.method],
          entityName: segments[0] ?? 'unknown',
          entityId: (req.params as Record<string, string>)?.id ?? null,
          ipAddress: req.ip,
          description: `${req.method} ${path}`,
        });
      }),
    );
  }
}
