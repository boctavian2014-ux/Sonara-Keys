export type NormalizedApiBase =
  | { ok: true; base: string }
  | { ok: false; error: string };

/**
 * Trims .env noise and rejects hosts that crash Android OkHttp
 * (`IllegalArgumentException: unexpected host`), e.g. underscores in labels.
 */
export function normalizeExpoPublicApiBase(raw: string): NormalizedApiBase {
  let s = raw.trim().replace(/\s+/g, '');
  if (s.length === 0) return { ok: false, error: 'Missing URL.' };
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
  while (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\/$/, '');
  if (!s) return { ok: false, error: 'Empty URL after trim.' };

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: `Invalid URL (check .env): ${s.slice(0, 96)}` };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'API base URL must start with http:// or https://.' };
  }

  const host = u.hostname;
  if (!host) return { ok: false, error: 'URL has no hostname.' };
  if (host.includes('_')) {
    return {
      ok: false,
      error:
        'Hostname contains "_" — Android OkHttp rejects it. Use a Railway/RunPod URL with hyphens only, or a custom domain.',
    };
  }

  const isIPv6 = host.includes(':');
  if (!isIPv6 && !/^[a-zA-Z0-9.-]+$/.test(host)) {
    return {
      ok: false,
      error: `Hostname has characters mobile HTTP stacks reject: ${host}`,
    };
  }

  let base = u.origin;
  let path = u.pathname.replace(/\/+$/, '') || '';
  if (path && path !== '/') {
    base += path;
  }
  return { ok: true, base };
}
