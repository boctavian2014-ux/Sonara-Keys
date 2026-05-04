/**
 * PCM helpers: RMS, peak normalization, Hann window, buffer merge.
 */

/** Below this (on raw PCM) we treat as silence; boosted once if barely above noise floor. */
const SILENCE_RMS = 0.002;
const SILENCE_RMS_HARD = 0.00035;

export function computeRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}

/** Scale so max absolute sample is 1; if silent, returns a zeroed copy. */
export function normalizeAudio(samples: Float32Array): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) return new Float32Array(samples.length);
  const out = new Float32Array(samples.length);
  const inv = 1 / peak;
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * inv;
  return out;
}

/** Hann window in-place on a copy (reduces spectral leakage at segment edges). */
export function applyHannWindow(samples: Float32Array): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);
  if (n === 1) return new Float32Array(samples);
  const out = new Float32Array(n);
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    out[i] = samples[i] * w;
  }
  return out;
}

/** Concatenate PCM chunks in order. */
export function mergeBuffers(buffers: Float32Array[]): Float32Array {
  if (buffers.length === 0) return new Float32Array(0);
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const b of buffers) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** Normalize → Hann. Returns null if segment is effectively silent (skip Basic Pitch). */
export function preprocessAudio(samples: Float32Array): Float32Array | null {
  if (samples.length === 0) return null;
  let rms = computeRMS(samples);
  let work = samples;
  if (rms < SILENCE_RMS && rms >= SILENCE_RMS_HARD) {
    const gain = Math.min(32, SILENCE_RMS / Math.max(rms, 1e-12));
    const boosted = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) boosted[i] = samples[i]! * gain;
    work = boosted;
    rms = computeRMS(work);
  }
  if (rms < SILENCE_RMS_HARD) return null;
  return applyHannWindow(normalizeAudio(work));
}

/** Same as preprocess but never drops for silence — use when full-session merge is borderline quiet. */
export function preprocessAudioAllowQuiet(samples: Float32Array): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  return applyHannWindow(normalizeAudio(samples));
}
