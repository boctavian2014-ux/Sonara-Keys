import type { DetectedNote } from '../../types/notes';
import { encodeWavMono16 } from './encodeWavMono16';

type TranscribeWindowResponse =
  | { ok: true; notes: unknown; engine?: string }
  | { ok: false; error?: string };

const PIANO_GPU_API_URL =
  typeof process.env.EXPO_PUBLIC_PIANO_GPU_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_PIANO_GPU_API_URL.trim()
    : '';

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

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: args.sessionId,
        wavBase64,
        sampleRate: args.sampleRate,
        windowStartSec: args.windowStartSec,
      }),
      signal: args.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'Network error.' };
  }

  let json: TranscribeWindowResponse;
  try {
    json = (await res.json()) as TranscribeWindowResponse;
  } catch {
    return { ok: false, error: `Bad response (${res.status}).` };
  }

  if (!res.ok || !json.ok) {
    const err = (json as { ok: false; error?: string }).error;
    return { ok: false, error: err || `HTTP ${res.status}` };
  }

  return { ok: true, notes: parseNotes(json.notes) };
}

