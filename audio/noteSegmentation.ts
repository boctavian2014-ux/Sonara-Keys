/**
 * Pure note onset/offset logic from a stream of median MIDI estimates.
 * Separates „sunet → MIDI” (pitchDetector) de „MIDI → note deschise/închise” (acest modul).
 */

/** Mai mic = răspuns mai rapid, risc de false onset. */
export const STABLE_FRAMES_TO_OPEN = 1;
/** Cadre consecutive cu alt MIDI înainte de schimbare de notă. */
export const STABLE_FRAMES_TO_CHANGE = 2;
/** Lungime mediană scurtă = mai puțină inerție pe zgomot. */
export const MIDI_MEDIAN_LEN = 3;

export type SegmentationRefs = {
  openMidi: number | null;
  candidateMidi: number | null;
  candidateCount: number;
};

export type SegmentationEffect =
  | { type: 'none' }
  | { type: 'open'; midi: number }
  | { type: 'extend' }
  | { type: 'closeAndOpen'; newMidi: number };

export function medianMidi(values: number[]): number {
  if (values.length === 0) return 69;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * Avansează mașina de stări pentru o singură estimare mediană `med` (după YIN + mediană inel).
 */
export function stepSegmentation(
  s: SegmentationRefs,
  med: number,
): { next: SegmentationRefs; effect: SegmentationEffect } {
  const open = s.openMidi;

  if (open === null) {
    let candidateMidi = s.candidateMidi;
    let candidateCount = s.candidateCount;
    if (candidateMidi === med) candidateCount += 1;
    else {
      candidateMidi = med;
      candidateCount = 1;
    }
    if (candidateCount >= STABLE_FRAMES_TO_OPEN) {
      return {
        next: { openMidi: med, candidateMidi: null, candidateCount: 0 },
        effect: { type: 'open', midi: med },
      };
    }
    return { next: { openMidi: null, candidateMidi, candidateCount }, effect: { type: 'none' } };
  }

  if (med === open) {
    return {
      next: { openMidi: open, candidateMidi: null, candidateCount: 0 },
      effect: { type: 'extend' },
    };
  }

  let candidateMidi = s.candidateMidi;
  let candidateCount = s.candidateCount;
  if (candidateMidi === med) candidateCount += 1;
  else {
    candidateMidi = med;
    candidateCount = 1;
  }

  if (candidateCount >= STABLE_FRAMES_TO_CHANGE) {
    return {
      next: { openMidi: med, candidateMidi: null, candidateCount: 0 },
      effect: { type: 'closeAndOpen', newMidi: med },
    };
  }

  return { next: { openMidi: open, candidateMidi, candidateCount }, effect: { type: 'none' } };
}

export function createEmptySegmentationRefs(): SegmentationRefs {
  return { openMidi: null, candidateMidi: null, candidateCount: 0 };
}
