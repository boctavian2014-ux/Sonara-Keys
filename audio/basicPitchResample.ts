/** Shared resampling + model URL for Basic Pitch (22.05 kHz input). */

export const BASIC_PITCH_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';

export const TARGET_RATE = 22050;

/** Linear resample mono PCM to 22.05 kHz (required by Basic Pitch). */
export function resampleTo22050(mono: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE) return mono;
  if (srcRate <= 0 || mono.length === 0) return new Float32Array(0);
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.max(1, Math.floor(mono.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const j = Math.floor(srcPos);
    const frac = srcPos - j;
    const s0 = mono[j] ?? 0;
    const s1 = mono[j + 1] ?? s0;
    out[i] = s0 + frac * (s1 - s0);
  }
  return out;
}
