import type { DetectedNote } from '../../types/notes';
import type { ChordEvent, ChordQuality, KeySignature, ScoreAnalysis } from '../../types/score';

const PITCH_CLASS_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function pc(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

function pcNameSharp(p: number): string {
  return PITCH_CLASS_NAMES_SHARP[((p % 12) + 12) % 12]!;
}

// Krumhansl-Schmuckler profiles (normalized-ish). Good enough for heuristic key pick.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function rotate(arr: number[], shift: number): number[] {
  const n = arr.length;
  const s = ((shift % n) + n) % n;
  return arr.slice(n - s).concat(arr.slice(0, n - s));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function histogramPitchClasses(notes: DetectedNote[]): number[] {
  const h = Array(12).fill(0) as number[];
  for (const n of notes) {
    const p = pc(n.midi);
    const w = Math.max(0.05, n.endTime - n.startTime);
    h[p] += w;
  }
  return h;
}

// Map tonic pitch class to major key signature accidental count/kind
// (C=0 sharps, G=1 sharp ...; F=1 flat, Bb=2 flats ...).
const MAJOR_KEY_SIG: Record<number, { kind: 'sharp' | 'flat'; count: number; tonicLabel: string }> = {
  0: { kind: 'sharp', count: 0, tonicLabel: 'C' },
  7: { kind: 'sharp', count: 1, tonicLabel: 'G' },
  2: { kind: 'sharp', count: 2, tonicLabel: 'D' },
  9: { kind: 'sharp', count: 3, tonicLabel: 'A' },
  4: { kind: 'sharp', count: 4, tonicLabel: 'E' },
  11: { kind: 'sharp', count: 5, tonicLabel: 'B' },
  6: { kind: 'sharp', count: 6, tonicLabel: 'F#' },
  1: { kind: 'sharp', count: 7, tonicLabel: 'C#' },
  5: { kind: 'flat', count: 1, tonicLabel: 'F' },
  10: { kind: 'flat', count: 2, tonicLabel: 'Bb' },
  3: { kind: 'flat', count: 3, tonicLabel: 'Eb' },
  8: { kind: 'flat', count: 4, tonicLabel: 'Ab' },
  1: { kind: 'flat', count: 5, tonicLabel: 'Db' },
  6: { kind: 'flat', count: 6, tonicLabel: 'Gb' },
  11: { kind: 'flat', count: 7, tonicLabel: 'Cb' },
};

export function inferKeySignature(notes: DetectedNote[]): KeySignature {
  if (notes.length === 0) {
    return { tonic: 'C', mode: 'major', accidentals: { kind: 'sharp', count: 0 } };
  }
  const h = histogramPitchClasses(notes);
  let bestScore = -Infinity;
  let bestPc = 0;
  let bestMode: 'major' | 'minor' = 'major';

  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = dot(h, rotate(KS_MAJOR, tonic));
    const min = dot(h, rotate(KS_MINOR, tonic));
    if (maj > bestScore) {
      bestScore = maj;
      bestPc = tonic;
      bestMode = 'major';
    }
    if (min > bestScore) {
      bestScore = min;
      bestPc = tonic;
      bestMode = 'minor';
    }
  }

  // Derive major key signature from relative major if minor
  const majorTonic = bestMode === 'minor' ? (bestPc + 3) % 12 : bestPc;

  // Basic mapping (we keep labels simple; enough for armura count kind)
  const majorSig =
    MAJOR_KEY_SIG[majorTonic] ??
    (majorTonic === 3
      ? { kind: 'flat', count: 3, tonicLabel: 'Eb' }
      : { kind: 'sharp', count: 0, tonicLabel: pcNameSharp(majorTonic) });

  const tonicLabel = bestMode === 'major' ? majorSig.tonicLabel : pcNameSharp(bestPc);

  return {
    tonic: tonicLabel,
    mode: bestMode,
    accidentals: { kind: majorSig.kind, count: majorSig.count },
  };
}

function chordQualityFromPitchClasses(rootPc: number, pcs: Set<number>): ChordQuality {
  const has = (interval: number) => pcs.has((rootPc + interval) % 12);
  // Triads
  const maj = has(4) && has(7);
  const min = has(3) && has(7);
  const dim = has(3) && has(6);
  const aug = has(4) && has(8);
  if (maj) return 'maj';
  if (min) return 'min';
  if (dim) return 'dim';
  if (aug) return 'aug';
  if (has(2) && has(7)) return 'sus2';
  if (has(5) && has(7)) return 'sus4';
  return 'unknown';
}

function labelForChord(root: string | null, quality: ChordQuality): string {
  if (!root) return 'Chord';
  if (quality === 'maj') return `${root}`;
  if (quality === 'min') return `${root}m`;
  if (quality === 'dim') return `${root}dim`;
  if (quality === 'aug') return `${root}aug`;
  if (quality === 'sus2') return `${root}sus2`;
  if (quality === 'sus4') return `${root}sus4`;
  return `${root}?`;
}

export function detectChordsFromQuantized(
  analysis: Pick<ScoreAnalysis, 'notes'>,
  onsetWindowBeats = 0.001,
): ChordEvent[] {
  const notes = analysis.notes;
  if (notes.length === 0) return [];

  // Group by onsetGroupId (already quantized); tolerate tiny float drift.
  const groups = new Map<string, typeof notes>();
  for (const n of notes) {
    const k = n.onsetGroupId;
    const arr = groups.get(k);
    if (arr) arr.push(n);
    else groups.set(k, [n]);
  }

  const out: ChordEvent[] = [];
  for (const [k, ns] of groups) {
    if (ns.length < 3) continue;
    const midis = ns.map((n) => n.midi).slice().sort((a, b) => a - b);
    const pcs = new Set(midis.map(pc));

    // Root guess: try each pc present; pick one that yields a known triad quality.
    let bestRoot: number | null = null;
    let bestQuality: ChordQuality = 'unknown';
    const presentPcs = Array.from(pcs);
    for (const r of presentPcs) {
      const q = chordQualityFromPitchClasses(r, pcs);
      if (q !== 'unknown') {
        bestRoot = r;
        bestQuality = q;
        break;
      }
    }
    const root = bestRoot != null ? pcNameSharp(bestRoot) : null;
    const bassMidi = midis[0]!;
    const onsetBeats = Number.parseFloat(k);
    const measureIndex = ns[0]!.measureIndex;
    const label = labelForChord(root, bestQuality);
    out.push({ onsetBeats, measureIndex, midis, root, quality: bestQuality, bassMidi, label });
  }

  return out.sort((a, b) => a.onsetBeats - b.onsetBeats);
}

