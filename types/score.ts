import type { DetectedNote } from './notes';

export type TimeSignature = {
  beatsPerBar: number; // e.g. 2, 3, 4, 6, 12
  beatUnit: 4 | 8; // 4=quarter, 8=eighth (we keep this limited initially)
};

export type KeyMode = 'major' | 'minor';

export type KeySignature = {
  tonic: string; // e.g. C, Bb, F#, etc (display label)
  mode: KeyMode;
  accidentals: { kind: 'sharp' | 'flat'; count: number };
};

export type NoteValue =
  | 'whole'
  | 'half'
  | 'half_dotted'
  | 'quarter'
  | 'quarter_dotted'
  | 'eighth'
  | 'eighth_dotted'
  | 'sixteenth'
  | 'thirty_second';

export type Hand = 'RH' | 'LH';

export type QuantizedNote = DetectedNote & {
  hand: Hand;
  /** Onset position in beats from start (quantized). */
  qOnsetBeats: number;
  /** Duration in beats (quantized). */
  qDurBeats: number;
  value: NoteValue;
  measureIndex: number;
  beatInMeasure: number;
  /** Notes that share the same onset group id form a chord candidate. */
  onsetGroupId: string;
};

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'sus2'
  | 'sus4'
  | 'unknown';

export type ChordEvent = {
  onsetBeats: number;
  measureIndex: number;
  /** MIDI pitches sorted ascending. */
  midis: number[];
  /** Root as pitch class name (C, C#, Db, ...) */
  root: string | null;
  quality: ChordQuality;
  /** Bass MIDI determines inversion when applicable. */
  bassMidi: number;
  label: string;
};

export type MeasureMeta = {
  index: number;
  startBeats: number;
  endBeats: number;
};

export type ScoreAnalysis = {
  tempoBpm: number | null;
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  measures: MeasureMeta[];
  notes: QuantizedNote[];
  chords: ChordEvent[];
};

