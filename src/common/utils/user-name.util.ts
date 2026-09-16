/**
 * Personal names live on the role profiles, not on the account — the data
 * dictionary's "User/Profile Separation" rule (ERD §5). Anything that needs a
 * human-readable name for a *user* (chat, alerts, emails, dashboards) resolves
 * it through here instead of reading `user.firstName`, which no longer exists.
 *
 * Accounts without a role profile (ADMIN / HOSPITAL_ADMIN — the ERD has no
 * profile entity for them) fall back to the email local part.
 */

export interface ProfileName {
  firstName: string;
  lastName: string;
}

export interface UserWithProfileNames {
  email?: string | null;
  patientProfile?: ProfileName | null;
  doctorProfile?: ProfileName | null;
  caregiverProfile?: ProfileName | null;
}

/**
 * Prisma `include` that loads just enough of every profile to build a name.
 * Use it wherever a query needs `displayName()` on the result.
 */
export const USER_NAME_INCLUDE = {
  patientProfile: { select: { firstName: true, lastName: true } },
  doctorProfile: { select: { firstName: true, lastName: true } },
  caregiverProfile: { select: { firstName: true, lastName: true } },
} as const;

/** The populated profile's name pair, or null for profile-less accounts. */
export function profileName(user: UserWithProfileNames): ProfileName | null {
  return user.patientProfile ?? user.doctorProfile ?? user.caregiverProfile ?? null;
}

/** "Omar Youssef" — falls back to the email local part, then "User". */
export function displayName(user: UserWithProfileNames): string {
  const name = profileName(user);
  if (name) return `${name.firstName} ${name.lastName}`.trim();
  const local = user.email?.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'User';
}

/** "Omar" — the greeting form used in emails and push titles. */
export function firstName(user: UserWithProfileNames): string {
  return profileName(user)?.firstName ?? displayName(user);
}

/** "Omar Youssef" from a profile row that already carries both names. */
export function fullName(name: ProfileName): string {
  return `${name.firstName} ${name.lastName}`.trim();
}
