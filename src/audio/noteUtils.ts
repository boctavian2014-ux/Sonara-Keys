import type { NoteEventTime } from '@spotify/basic-pitch';

import { frequencyToNoteName } from '../../audio/pitchDetector';
import type { DetectedNote } from '../../types/notes';

const MIN_NOTE_MS = 80;
const MERGE_GAP_MS = 50;

export function filterShortNotes(events: NoteEventTime[]): NoteEventTime[] {
  return events.filter((e) => e.durationSeconds * 1000 >= MIN_NOTE_MS);
}

/**
 * Merge consecutive same-MIDI notes when the gap between end and next start is < 50 ms.
 * Input should be sorted by start time.
 */
export function mergeConsecutiveNotes(events: NoteEventTime[]): NoteEventTime[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const out: NoteEventTime[] = [];
  let cur: NoteEventTime = { ...sorted[0]! };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    const curMidi = Math.round(cur.pitchMidi);
    const nextMidi = Math.round(next.pitchMidi);
    const curEnd = cur.startTimeSeconds + cur.durationSeconds;
    const gapMs = (next.startTimeSeconds - curEnd) * 1000;
    if (curMidi === nextMidi && gapMs < MERGE_GAP_MS) {
      const newEnd = next.startTimeSeconds + next.durationSeconds;
      cur = {
        ...cur,
        durationSeconds: newEnd - cur.startTimeSeconds,
        amplitude: Math.max(cur.amplitude, next.amplitude),
      };
    } else {
      out.push(cur);
      cur = { ...next };
    }
  }
  out.push(cur);
  return out;
}

export function mapToDetectedNotes(events: NoteEventTime[], idPrefix: string): DetectedNote[] {
  return events.map((n, i) => {
    const midi = Math.round(Math.min(127, Math.max(0, n.pitchMidi)));
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const { name, octave } = frequencyToNoteName(hz);
    return {
      id: `${idPrefix}-${i}-${n.startTimeSeconds.toFixed(4)}`,
      name,
      octave,
      midi,
      startTime: n.startTimeSeconds,
      endTime: n.startTimeSeconds + n.durationSeconds,
    };
  });
}
