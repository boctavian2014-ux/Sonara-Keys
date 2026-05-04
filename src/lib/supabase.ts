import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url =
  typeof process.env.EXPO_PUBLIC_SUPABASE_URL === 'string'
    ? process.env.EXPO_PUBLIC_SUPABASE_URL.trim()
    : '';
const anonKey =
  typeof process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY === 'string'
    ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY.trim()
    : '';

/**
 * Client Supabase pentru Expo (cheia `anon` e publică — protejează datele cu RLS în dashboard).
 * `null` dacă lipsește URL sau cheia din `.env`.
 */
export const supabase: SupabaseClient | null =
  url.length > 0 && anonKey.length > 0
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase != null;
}
