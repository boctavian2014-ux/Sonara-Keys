import type { DetectedNote } from '../../types/notes';

/** A4 = 440 Hz; equal temperament. */
export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Duration of a detected note segment in milliseconds.
 * `startTime` / `endTime` on `DetectedNote` are in seconds (session timeline).
 */
export function noteDurationMs(note: DetectedNote): number {
  return Math.abs(note.endTime - note.startTime) * 1000;
}

export function sortNotesByTime(notes: DetectedNote[]): DetectedNote[] {
  return [...notes].sort((a, b) => a.startTime - b.startTime);
}
