/**
 * Bridge: Re-exports UserSessionService for legacy Express middleware.
 * For NestJS usage, inject UserSessionService from UserSessionModule.
 */
import { UserSessionService as NestUserSessionService } from '../modules/user-session/user-session.service';

export { NestUserSessionService as UserSessionService };

// Compat: legacy middleware calls UserSessionService.updateUserSessionActivity (instance method in Nest)
// Add static no-op for Express middleware without DI context
(NestUserSessionService as unknown as { updateUserSessionActivity: (id: string) => Promise<void> })
  .updateUserSessionActivity = async () => {};
