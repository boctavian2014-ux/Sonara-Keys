import type { DetectedNote } from '../../types/notes';
import { encodeWavMono16 } from './encodeWavMono16';

type TranscribeWindowResponse =
  | { ok: true; notes: unknown; engine?: string }
  | { ok: false; error?: string };

const PIANO_GPU_API_URL =
  typeof process.env.EXPO_PUBLIC_PIANO_GPU_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_PIANO_GPU_API_URL.trim()
    : '';

const PIANO_GPU_API_KEY =
  typeof process.env.EXPO_PUBLIC_PIANO_GPU_API_KEY === 'string'
    ? process.env.EXPO_PUBLIC_PIANO_GPU_API_KEY.trim()
    : '';

function parseGpuFetchTimeoutMs(): number {
  const raw =
    typeof process.env.EXPO_PUBLIC_PIANO_GPU_FETCH_TIMEOUT_MS === 'string'
      ? process.env.EXPO_PUBLIC_PIANO_GPU_FETCH_TIMEOUT_MS.trim()
      : '';
  const n = raw.length > 0 ? Number(raw) : 120_000;
  return Number.isFinite(n) && n >= 20_000 ? n : 120_000;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const page = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += page) {
    const sub = bytes.subarray(i, i + page);
    let s = '';
    for (let j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j]!);
    chunks.push(s);
  }
  const bin = chunks.join('');
  if (typeof btoa === 'function') return btoa(bin);
  throw new Error('btoa is not available in this runtime');
}

function parseNotes(raw: unknown): DetectedNote[] {
  if (!Array.isArray(raw)) return [];
  const out: DetectedNote[] = [];
  for (const n of raw) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    if (
      typeof o.midi !== 'number' ||
      typeof o.startTime !== 'number' ||
      typeof o.endTime !== 'number' ||
      typeof o.name !== 'string' ||
      typeof o.octave !== 'number'
    ) {
      continue;
    }
    out.push({
      id: typeof o.id === 'string' ? o.id : `pti-${out.length}-${o.startTime}`,
      name: o.name,
      octave: o.octave,
      startTime: o.startTime,
      endTime: o.endTime,
      midi: Math.round(o.midi),
    });
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

export async function transcribeWindowRemote(args: {
  sessionId: string;
  windowStartSec: number;
  pcm: Float32Array;
  sampleRate: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; notes: DetectedNote[] } | { ok: false; error: string }> {
  const base = PIANO_GPU_API_URL.replace(/\/$/, '');
  if (!base) return { ok: false, error: 'Missing EXPO_PUBLIC_PIANO_GPU_API_URL.' };

  const wav = encodeWavMono16(args.pcm, args.sampleRate);
  const wavBase64 = uint8ToBase64(new Uint8Array(wav));
  const url = `${base}/transcribe-window`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PIANO_GPU_API_KEY) headers['X-Sonara-Api-Key'] = PIANO_GPU_API_KEY;

  const timeoutMs = parseGpuFetchTimeoutMs();
  const combined = new AbortController();
  const tid = setTimeout(() => combined.abort(), timeoutMs);
  const parent = args.signal;
  const onParentAbort = () => combined.abort();
  if (parent) parent.addEventListener('abort', onParentAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: args.sessionId,
        wavBase64,
        sampleRate: args.sampleRate,
        windowStartSec: args.windowStartSec,
      }),
      signal: combined.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (parent?.aborted) {
        return { ok: false, error: 'Aborted.' };
      }
      return {
        ok: false,
        error: `GPU request timeout (>${timeoutMs} ms). Increase EXPO_PUBLIC_PIANO_GPU_FETCH_TIMEOUT_MS or use a smaller EXPO_PUBLIC_PIANO_GPU_WINDOW_SEC.`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'Network error.' };
  } finally {
    clearTimeout(tid);
    parent?.removeEventListener('abort', onParentAbort);
  }

  const rawText = await res.text();
  let json: TranscribeWindowResponse;
  try {
    json = JSON.parse(rawText) as TranscribeWindowResponse;
  } catch {
    const strip = rawText.replace(/\s+/g, ' ').trim().slice(0, 160);
    const hint = strip ? ` ${strip}` : '';
    return {
      ok: false,
      error:
        res.status === 502
          ? `Gateway 502 (RunPod nu ajunge la server sau timeout). Verifică: pod pornit, uvicorn pe 8789, loguri pod.${hint}`
          : `Bad response (${res.status}).${hint}`,
    };
  }

  if (!res.ok || !json.ok) {
    const j = json as { ok?: boolean; error?: string; detail?: unknown };
    let err = j.error;
    if (!err && j.detail != null) {
      err =
        typeof j.detail === 'string'
          ? j.detail
          : Array.isArray(j.detail)
            ? j.detail.map((x) => String(x)).join(' ')
            : String(j.detail);
    }
    return { ok: false, error: err || `HTTP ${res.status}` };
  }

  return { ok: true, notes: parseNotes(json.notes) };
}

