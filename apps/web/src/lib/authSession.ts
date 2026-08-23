import type { EntityVerificationStatus, IdentityVerificationStatus, UserRole } from '@recon/domain';

/** The authenticated principal, as reported by the server (login response or /api/auth/me) --
 * ADR-0002 step 6: role travels with the session instead of being looked up from a hardcoded
 * client-side username map. Lives here rather than in App.tsx so SignupScreen.tsx (which App.tsx
 * itself imports) doesn't create a circular dependency importing it back. */
export type AuthenticatedUserSession = {
  username: string;
  role: UserRole;
  organizationId: string;
  firstName?: string;
  lastName?: string;
  // Login/signup don't return these -- both start out 'pending'/'pending'/false and are corrected
  // moments later by App.tsx's own /api/auth/me effect, which reads them live from the database.
  identityVerificationStatus: IdentityVerificationStatus;
  entityVerificationStatus: EntityVerificationStatus;
  isFullyVerified: boolean;
};
