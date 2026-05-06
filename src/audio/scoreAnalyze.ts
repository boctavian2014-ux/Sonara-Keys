import type { DetectedNote } from '../../types/notes';
import type { ScoreAnalysis } from '../../types/score';
import { quantizeNotesToScore } from './scoreQuantize';
import { detectChordsFromQuantized, inferKeySignature } from './scoreKeyChord';

export function analyzeScore(notes: DetectedNote[]): ScoreAnalysis {
  const base = quantizeNotesToScore(notes);
  const keySignature = inferKeySignature(notes);
  const chords = detectChordsFromQuantized(base);
  return {
    ...base,
    keySignature,
    chords,
  };
}

