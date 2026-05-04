import type { DetectedNote } from '../../types/notes';
import { encodeWavMono16 } from './encodeWavMono16';

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

function parseNotes(raw: unknown): DetectedNote[] | null {
  if (!Array.isArray(raw)) return null;
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
      id: typeof o.id === 'string' ? o.id : `remote-${out.length}-${o.startTime}`,
      name: o.name,
      octave: o.octave,
      startTime: o.startTime,
      endTime: o.endTime,
      midi: Math.round(o.midi),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * POST WAV to the transcribe backend (local Basic Pitch server; see docs/local-basic-pitch.md).
 * Returns null if the request fails, JSON is invalid, or notes[] is empty.
 */
export async function transcribeRemote(
  baseUrl: string,
  pcm: Float32Array,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<DetectedNote[] | null> {
  const base = baseUrl.replace(/\/$/, '');
  const wav = encodeWavMono16(pcm, sampleRate);
  const wavBase64 = uint8ToBase64(new Uint8Array(wav));
  const res = await fetch(`${base}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wavBase64 }),
    signal,
  });
  let json: { ok?: boolean; notes?: unknown; error?: string };
  try {
    json = (await res.json()) as { ok?: boolean; notes?: unknown; error?: string };
  } catch {
    return null;
  }
  if (!res.ok || !json.ok) {
    console.warn('[transcribeRemote]', json.error ?? res.status);
    return null;
  }
  return parseNotes(json.notes);
}
