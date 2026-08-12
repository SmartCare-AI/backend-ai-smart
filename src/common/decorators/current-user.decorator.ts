import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export type AuthenticatedUser = Omit<User, 'password'>;

/**
 * Injects the authenticated user (attached by JwtStrategy) into a handler.
 *
 * @example
 * getProfile(@CurrentUser() user: AuthenticatedUser) {}
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
