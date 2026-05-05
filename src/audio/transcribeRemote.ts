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

async function parseJsonResponse(res: Response): Promise<DetectedNote[] | null> {
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

const USE_JSON_FALLBACK =
  typeof process.env.EXPO_PUBLIC_TRANSCRIBE_USE_JSON === 'string' &&
  process.env.EXPO_PUBLIC_TRANSCRIBE_USE_JSON.trim() === '1';

/**
 * POST WAV to the transcribe backend (local Basic Pitch server).
 * Prefers raw `application/octet-stream` body; falls back to JSON `{ wavBase64 }` if needed.
 */
export async function transcribeRemote(
  baseUrl: string,
  pcm: Float32Array,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<DetectedNote[] | null> {
  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}/transcribe`;
  const tAll = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const encodeWav = (): ArrayBuffer => encodeWavMono16(pcm, sampleRate);

  if (!USE_JSON_FALLBACK) {
    const tEnc0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const wavBuf = encodeWav();
    const encodeMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tEnc0;

    const tFetch0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Wav-Sample-Rate': String(sampleRate),
        },
        body: wavBuf,
        signal,
      });
      const fetchMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tFetch0;
      const notes = res.ok ? await parseJsonResponse(res) : null;
      const totalMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAll;
      if (__DEV__) {
        console.log(
          `[transcribeRemote] octet-stream encodeMs=${encodeMs.toFixed(0)} fetch+parseMs=${fetchMs.toFixed(0)} totalMs=${totalMs.toFixed(0)} ok=${res.ok} notes=${notes?.length ?? 0}`,
        );
      }
      if (notes && notes.length > 0) return notes;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError') {
        if (__DEV__) console.warn('[transcribeRemote] octet-stream aborted');
        return null;
      }
      if (__DEV__) console.warn('[transcribeRemote] octet-stream failed, trying JSON fallback', e);
    }
  }

  const tEncJson0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const wav = encodeWavMono16(pcm, sampleRate);
  const wavBase64 = uint8ToBase64(new Uint8Array(wav));
  const encodeJsonMs =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tEncJson0;

  const tFetchJson0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wavBase64 }),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (__DEV__) console.warn('[transcribeRemote] json aborted');
      return null;
    }
    throw e;
  }
  const fetchJsonMs =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tFetchJson0;
  const notes = await parseJsonResponse(res);
  const totalJsonMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAll;
  if (__DEV__) {
    console.log(
      `[transcribeRemote] json encodeMs=${encodeJsonMs.toFixed(0)} fetch+parseMs=${fetchJsonMs.toFixed(0)} totalMs=${totalJsonMs.toFixed(0)} ok=${res.ok} notes=${notes?.length ?? 0}`,
    );
  }
  return notes;
}
