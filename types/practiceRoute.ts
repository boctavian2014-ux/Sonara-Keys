import type { SavedMelodyPayload } from './savedMelody';

export type PracticeOpenSource =
  | { kind: 'sample' }
  | { kind: 'saved'; saved: SavedMelodyPayload };
