import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to specific roles. ADMIN always passes.
 * Route-level check only — resource ownership ("is this MY patient?")
 * is enforced in services via ConsentService.
 *
 * @example
 * @Roles(Role.DOCTOR)
 * @Post('visits')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
