/**
 * Communities is retired for everyone except an allowlist.
 *
 * Most accounts get Notifications in the dock slot that used to be Communities.
 * Only the usernames below may open `/communities` or see that dock tab; everyone
 * else is redirected if they hit the route.
 */

const COMMUNITY_USERNAMES = new Set(['piuxxh']);

export function canAccessCommunities(username: string | null | undefined): boolean {
  if (!username) return false;
  return COMMUNITY_USERNAMES.has(username.toLowerCase());
}
