import type { DetectedNote } from '../../types/notes';
import type { NoteValue, QuantizedNote, ScoreAnalysis, TimeSignature } from '../../types/score';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function estimateTempoBpm(notes: DetectedNote[]): number | null {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i]!.startTime - sorted[i - 1]!.startTime;
    if (dt > 0.03 && dt < 1.2) iois.push(dt);
  }
  const m = median(iois);
  if (m == null) return null;
  const bpm = 60 / m;
  // Keep it in a plausible piano practice range
  return clamp(Math.round(bpm), 40, 220);
}

function quantizeToGrid(x: number, step: number): number {
  if (step <= 0) return x;
  return Math.round(x / step) * step;
}

function noteValueFromBeats(beats: number): NoteValue {
  // Interpret 1 beat as a quarter note by default.
  // We'll map common values with dotted variants.
  const b = beats;
  const eps = 1e-6;
  const near = (v: number) => Math.abs(b - v) <= 0.12 + eps;
  if (near(4)) return 'whole';
  if (near(3)) return 'half_dotted';
  if (near(2)) return 'half';
  if (near(1.5)) return 'quarter_dotted';
  if (near(1)) return 'quarter';
  if (near(0.75)) return 'eighth_dotted';
  if (near(0.5)) return 'eighth';
  if (near(0.25)) return 'sixteenth';
  return 'thirty_second';
}

function inferTimeSignatureCandidate(
  qNotes: Pick<QuantizedNote, 'qOnsetBeats' | 'qDurBeats'>[],
  candidates: TimeSignature[],
): TimeSignature {
  // Choose the candidate that minimizes bar overflow when packing notes sequentially.
  // This is heuristic, but stable for short phrases.
  let best = candidates[0] ?? { beatsPerBar: 4, beatUnit: 4 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (const ts of candidates) {
    const barLen = ts.beatsPerBar * (ts.beatUnit === 8 ? 0.5 : 1);
    if (barLen <= 0) continue;

    let score = 0;
    for (const n of qNotes) {
      const end = n.qOnsetBeats + Math.max(0.125, n.qDurBeats);
      const mod = end % barLen;
      // penalize endings that fall far from bar boundaries
      score += Math.min(mod, barLen - mod);
    }
    // slight preference for simpler meters
    score += ts.beatsPerBar === 4 && ts.beatUnit === 4 ? -0.25 : 0;
    if (score < bestScore) {
      bestScore = score;
      best = ts;
    }
  }

  return best;
}

export function quantizeNotesToScore(notes: DetectedNote[]): Omit<ScoreAnalysis, 'keySignature' | 'chords'> {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const tempoBpm = estimateTempoBpm(sorted);
  const beatSec = tempoBpm != null ? 60 / tempoBpm : 0.5; // fallback 120bpm

  // Quantize onset to 1/8 beat grid; duration to 1/8 beat grid as a start.
  const grid = 0.125;

  const q: QuantizedNote[] = sorted.map((n) => {
    const onsetBeats = n.startTime / beatSec;
    const durBeats = Math.max(0.125, (n.endTime - n.startTime) / beatSec);
    const qOnsetBeats = quantizeToGrid(onsetBeats, grid);
    const qDurBeats = clamp(quantizeToGrid(durBeats, grid), 0.125, 16);
    const value = noteValueFromBeats(qDurBeats);
    const hand: QuantizedNote['hand'] = n.midi >= 60 ? 'RH' : 'LH';
    const onsetGroupId = `${qOnsetBeats.toFixed(3)}`;
    return {
      ...n,
      hand,
      qOnsetBeats,
      qDurBeats,
      value,
      measureIndex: 0,
      beatInMeasure: 0,
      onsetGroupId,
    };
  });

  const timeSignature = inferTimeSignatureCandidate(
    q.map((n) => ({ qOnsetBeats: n.qOnsetBeats, qDurBeats: n.qDurBeats })),
    [
      { beatsPerBar: 2, beatUnit: 4 },
      { beatsPerBar: 3, beatUnit: 4 },
      { beatsPerBar: 4, beatUnit: 4 },
      { beatsPerBar: 6, beatUnit: 8 },
      { beatsPerBar: 12, beatUnit: 8 },
    ],
  );

  const barLenBeats = timeSignature.beatsPerBar * (timeSignature.beatUnit === 8 ? 0.5 : 1);

  const totalBeats = q.length > 0 ? Math.max(...q.map((n) => n.qOnsetBeats + n.qDurBeats)) : 0;
  const measureCount = Math.max(1, Math.ceil(totalBeats / barLenBeats));
  const measures = Array.from({ length: measureCount }, (_, i) => {
    const startBeats = i * barLenBeats;
    return { index: i, startBeats, endBeats: startBeats + barLenBeats };
  });

  for (const n of q) {
    const idx = Math.max(0, Math.min(measureCount - 1, Math.floor(n.qOnsetBeats / barLenBeats)));
    const beatInMeasure = n.qOnsetBeats - idx * barLenBeats;
    n.measureIndex = idx;
    n.beatInMeasure = beatInMeasure;
  }

  return {
    tempoBpm,
    timeSignature,
    measures,
    notes: q,
  };
}

