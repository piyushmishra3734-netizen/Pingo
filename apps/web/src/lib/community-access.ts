/**
 * Communities is retired for everyone except an allowlist.
 *
 * Most accounts get Notifications in the dock slot that used to be Communities.
 * Only the operator account may open `/communities` or see that dock tab; everyone
 * else is redirected if they hit the route.
 */

import { isOperator } from './operator.js';

/** By account id, not username - see `operator.ts`. */
export function canAccessCommunities(userId: string | null | undefined): boolean {
  return isOperator(userId);
}
