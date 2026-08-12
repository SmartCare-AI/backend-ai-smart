import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public. All routes require a valid JWT by default
 * (secure-by-default via the global JwtAuthGuard).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
