import { getSupabaseClient } from '../../lib/supabase/client.js';

export type AiPublicIdentity = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  /** Cover behind the face, and where it sits vertically (0-100). */
  bannerUrl?: string;
  bannerOffset: number;
};

/** Shared face every user sees for PINGO AI (owner-set defaults). */
export async function fetchAiPublicIdentity(): Promise<AiPublicIdentity | undefined> {
  const { data, error } = await getSupabaseClient().rpc('get_ai_public_identity');
  if (error) return undefined;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return undefined;
  const r = row as {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    banner_url: string | null;
    banner_offset: number | null;
  };
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name || 'PINGO',
    ...(r.avatar_url ? { avatarUrl: r.avatar_url } : {}),
    ...(r.bio ? { bio: r.bio } : {}),
    ...(r.banner_url ? { bannerUrl: r.banner_url } : {}),
    bannerOffset: r.banner_offset ?? 50,
  };
}

export async function isAiOwner(): Promise<boolean> {
  const { data } = await getSupabaseClient().rpc('is_ai_owner');
  return Boolean(data);
}
