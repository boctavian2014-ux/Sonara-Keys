import type { DetectedNote } from '../../types/notes';

export type PracticeNote = {
  midi: number;
  name: string;
  octave: number;
  duration: 'q' | 'h' | 'w' | '8';
};

/** Shift timeline so first note starts at 0; stable ids for staff/playback. */
export function normalizeDetectedTimesToZero(notes: DetectedNote[]): DetectedNote[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  if (sorted.length === 0) return [];
  const t0 = sorted[0]!.startTime;
  return sorted.map((n, i) => ({
    ...n,
    id: `norm-${i}-${n.midi}-${(n.startTime - t0).toFixed(3)}`,
    startTime: n.startTime - t0,
    endTime: n.endTime - t0,
  }));
}

function inferDurationFromSpan(n: DetectedNote): PracticeNote['duration'] {
  const ms = Math.max(0, n.endTime - n.startTime) * 1000;
  if (ms < 180) return '8';
  if (ms < 700) return 'q';
  if (ms < 1400) return 'h';
  return 'w';
}

/** Build practice melody (one note per step) from detected segments, time order. */
export function detectedNotesToPracticeNotes(notes: DetectedNote[]): PracticeNote[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  return sorted.map((n) => ({
    midi: n.midi,
    name: n.name,
    octave: n.octave,
    duration: inferDurationFromSpan(n),
  }));
}

/** Approximate note length in ms for practice feedback / auto-play. */
export function practiceNoteDurationMs(n: PracticeNote): number {
  switch (n.duration) {
    case 'w':
      return 1920;
    case 'h':
      return 960;
    case 'q':
      return 480;
    case '8':
      return 240;
    default:
      return 480;
  }
}

/** Build timed `DetectedNote`s from a practice melody for staff + playback (seconds timeline). */
export function practiceMelodyToDetectedNotes(melody: PracticeNote[], stepMs = 520, holdMs = 480): DetectedNote[] {
  const stepS = stepMs / 1000;
  const holdS = holdMs / 1000;
  let t = 0;
  return melody.map((n, i) => {
    const startTime = t;
    const endTime = t + holdS;
    t += stepS;
    return {
      id: `practice-pb-${i}-${n.midi}`,
      name: n.name,
      octave: n.octave,
      midi: n.midi,
      startTime,
      endTime,
    };
  });
}

/** C major scale one octave for beginner practice. */
export const SAMPLE_MELODY: PracticeNote[] = [
  { midi: 60, name: 'C', octave: 4, duration: 'q' },
  { midi: 62, name: 'D', octave: 4, duration: 'q' },
  { midi: 64, name: 'E', octave: 4, duration: 'q' },
  { midi: 65, name: 'F', octave: 4, duration: 'q' },
  { midi: 67, name: 'G', octave: 4, duration: 'q' },
  { midi: 69, name: 'A', octave: 4, duration: 'q' },
  { midi: 71, name: 'B', octave: 4, duration: 'q' },
  { midi: 72, name: 'C', octave: 5, duration: 'q' },
];
