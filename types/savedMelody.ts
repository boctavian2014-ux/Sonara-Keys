import type { DetectedNote } from './notes';

export const SAVED_MELODY_SCHEMA_VERSION = 1 as const;

/** On-disk JSON shape for a user-saved melody (local library). */
export type SavedMelodyPayload = {
  version: typeof SAVED_MELODY_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAtIso: string;
  notes: DetectedNote[];
};

export type SavedMelodySummary = {
  id: string;
  title: string;
  createdAtIso: string;
  noteCount: number;
};
