/**
 * Kinde (https://kinde.com) — setează în `.env`:
 * EXPO_PUBLIC_KINDE_DOMAIN=https://YOUR_SUBDOMAIN.kinde.com
 * EXPO_PUBLIC_KINDE_CLIENT_ID=...
 *
 * În Kinde Dashboard → Applications → Callback URLs adaugă redirect-ul
 * generat de Expo (vezi docs.kinde.com Expo), de obicei:
 *   sonarakeys://kinde_callback
 * (scheme din app.json)
 */
export type KindeEnvConfig = {
  domain: string;
  clientId: string;
};

export function getKindeAuthConfig(): KindeEnvConfig | null {
  const domain =
    typeof process.env.EXPO_PUBLIC_KINDE_DOMAIN === 'string'
      ? process.env.EXPO_PUBLIC_KINDE_DOMAIN.trim()
      : '';
  const clientId =
    typeof process.env.EXPO_PUBLIC_KINDE_CLIENT_ID === 'string'
      ? process.env.EXPO_PUBLIC_KINDE_CLIENT_ID.trim()
      : '';
  if (!domain || !clientId) return null;
  return { domain, clientId };
}
