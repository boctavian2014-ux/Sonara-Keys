/**
 * Time-domain pitch (YIN-style cumulative mean normalized difference)
 * and helpers for RMS gating + frequency → note mapping.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type NoteInfo = {
  name: string;
  octave: number;
  midi: number;
};

/** A4 = 440 Hz concert pitch */
export function frequencyToNoteName(frequency: number): NoteInfo {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return { name: '?', octave: 0, midi: 0 };
  }
  const midiFloat = 12 * Math.log2(frequency / 440) + 69;
  const midi = Math.round(Math.min(127, Math.max(0, midiFloat)));
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12] ?? 'C';
  return { name, octave, midi };
}

export function midiToLabel(midi: number): string {
  const o = Math.floor(midi / 12) - 1;
  const n = NOTE_NAMES[midi % 12] ?? 'C';
  return `${n}${o}`;
}

/** Decode base64 little-endian PCM16 to Float32 [-1, 1] (mono). */
export function pcm16Base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const sampleCount = bytes.length >>> 1;
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function rmsEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}

/**
 * YIN pitch estimate (first dip below `threshold` in CMND).
 * `buffer` should hold >= 2 * maxTau samples; we use halfLength = floor(n/2).
 */
export function yinDetectPitch(buffer: Float32Array, sampleRate: number, threshold = 0.15): number | null {
  const n = buffer.length;
  const half = Math.floor(n / 2);
  if (half < 32) return null;

  const yin = new Float64Array(half);
  let rmsAcc = 0;
  for (let j = 0; j < n; j++) rmsAcc += buffer[j] * buffer[j];
  const rms = Math.sqrt(rmsAcc / n);
  if (rms < 0.004) return null;

  // Difference function d(tau)
  for (let tau = 0; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    yin[tau] = sum;
  }

  // Cumulative mean normalized difference d'(tau)
  yin[0] = 1;
  let running = 0;
  for (let tau = 1; tau < half; tau++) {
    running += yin[tau];
    const denom = running < 1e-12 ? 1e-12 : running;
    yin[tau] = (yin[tau] * tau) / denom;
  }

  const minHz = 70;
  const maxHz = 5000;
  const minTau = Math.floor(sampleRate / maxHz);
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / minHz));

  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yin[tau] < threshold) {
      let t = tau;
      while (t + 1 < half && yin[t + 1] < yin[t]) t++;
      const improved = parabolicMin(yin, t);
      const f = sampleRate / improved;
      if (f >= minHz && f <= maxHz) return f;
    }
  }
  return null;
}

function parabolicMin(y: Float64Array, tau: number): number {
  const x0 = tau > 0 ? tau - 1 : tau;
  const x1 = tau;
  const x2 = tau + 1 < y.length ? tau + 1 : tau;
  const s0 = y[x0];
  const s1 = y[x1];
  const s2 = y[x2];
  const denom = s0 - 2 * s1 + s2;
  if (Math.abs(denom) < 1e-12) return tau;
  const delta = 0.5 * (s0 - s2) / denom;
  return Math.max(1, Math.min(y.length - 2, tau + delta));
}

/** Exponential smoothing on Hz (clarity over raw jumps). */
export function smoothHz(prev: number | null, next: number | null, alpha = 0.35): number | null {
  if (next == null) return prev;
  if (prev == null) return next;
  return prev * (1 - alpha) + next * alpha;
}
