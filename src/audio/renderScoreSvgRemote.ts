import type { ScoreAnalysis } from '../../types/score';
import { normalizeExpoPublicApiBase } from './normalizeExpoPublicApiBase';

type RenderScoreSvgResponse = { ok: true; svg: string; cached?: boolean } | { ok: false; error: string };

const SCORE_RENDER_RAW =
  typeof process.env.EXPO_PUBLIC_SCORE_RENDER_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_SCORE_RENDER_API_URL.trim()
    : '';

const TRANSCRIBE_RAW =
  typeof process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL.trim()
    : '';

function getBaseResolved(): ReturnType<typeof normalizeExpoPublicApiBase> {
  const raw = SCORE_RENDER_RAW || TRANSCRIBE_RAW;
  if (!raw) {
    return { ok: false, error: 'Missing EXPO_PUBLIC_SCORE_RENDER_API_URL (or EXPO_PUBLIC_TRANSCRIBE_API_URL).' };
  }
  return normalizeExpoPublicApiBase(raw);
}

export async function renderScoreSvgRemote(
  analysis: ScoreAnalysis,
  signal?: AbortSignal,
): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  const resolved = getBaseResolved();
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  const base = resolved.base;

  const url = `${base}/render-score-svg`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'Failed to fetch score SVG.' };
  }

  const rawText = await res.text();
  let json: RenderScoreSvgResponse;
  try {
    json = JSON.parse(rawText) as RenderScoreSvgResponse;
  } catch {
    if (res.status === 404) {
      return {
        ok: false,
        error:
          '404 — pe acest URL nu există POST /render-score-svg. Folosește server-ts (Railway) din ultimul Dockerfile sau setează EXPO_PUBLIC_SCORE_RENDER_API_URL către un host care are LilyPond.',
      };
    }
    const strip = rawText.replace(/\s+/g, ' ').trim().slice(0, 120);
    return { ok: false, error: `Răspuns ne-JSON (${res.status}).${strip ? ` ${strip}` : ''}` };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, error: (json as { ok: false; error: string }).error || `HTTP ${res.status}` };
  }
  if (typeof json.svg !== 'string' || json.svg.length < 32) {
    return { ok: false, error: 'Empty SVG received.' };
  }
  return { ok: true, svg: json.svg };
}

