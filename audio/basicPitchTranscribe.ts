/**
 * Transcriere polifonică din PCM mono folosind Spotify Basic Pitch (@spotify/basic-pitch).
 * Modelul se încarcă de pe CDN (necesită rețea la prima rulare).
 */
import { runBasicPitchOnPcm } from '../src/audio/basicPitchRunner';

import type { DetectedNote } from '../types/notes';

export { BASIC_PITCH_MODEL_URL, TARGET_RATE, resampleTo22050 } from './basicPitchResample';

/**
 * Rulează Basic Pitch pe PCM mono; întoarce note sortate după timp.
 * Folosește același pipeline ca `useNoteDetection` (parametri tuneți + post-procesare).
 */
export async function transcribePcmToDetectedNotes(
  mono: Float32Array,
  sampleRate: number,
  onProgress: (pct: number) => void,
): Promise<DetectedNote[]> {
  return runBasicPitchOnPcm(mono, sampleRate, onProgress);
}
