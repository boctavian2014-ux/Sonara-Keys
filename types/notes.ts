/** One segmented note from the pitch pipeline (solo line). */
export type DetectedNote = {
  id: string;
  /** Letter name without octave, e.g. C, D#, Bb */
  name: string;
  octave: number;
  startTime: number;
  endTime: number;
  /** MIDI note number (0–127), rounded to nearest semitone */
  midi: number;
};
