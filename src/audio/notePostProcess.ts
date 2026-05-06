import type { DetectedNote } from '../../types/notes';

export function filterShortNotes(notes: DetectedNote[], minMs = 60): DetectedNote[] {
  return notes.filter((n) => (n.endTime - n.startTime) * 1000 >= minMs);
}

export function mergeLegato(notes: DetectedNote[], maxGapMs = 80): DetectedNote[] {
  if (notes.length === 0) return [];
  const sorted = sortByTime(notes);
  const maxGapSec = maxGapMs / 1000;
  const out: DetectedNote[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1]!;
    const next = sorted[i]!;
    const gap = next.startTime - cur.endTime;
    if (cur.midi === next.midi && gap <= maxGapSec) {
      out[out.length - 1] = {
        ...cur,
        id: `${cur.id}-m-${next.id}`,
        endTime: Math.max(cur.endTime, next.endTime),
      };
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

/**
 * More permissive merge for sustain pedal / long decays.
 * Keeps repeated notes if there's a clear gap.
 */
export function mergeSustain(notes: DetectedNote[], maxGapMs = 240, minPrevMs = 120): DetectedNote[] {
  if (notes.length === 0) return [];
  const sorted = sortByTime(notes);
  const maxGapSec = maxGapMs / 1000;
  const minPrevSec = minPrevMs / 1000;
  const out: DetectedNote[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1]!;
    const next = sorted[i]!;
    const gap = next.startTime - cur.endTime;
    const curDur = cur.endTime - cur.startTime;
    if (cur.midi === next.midi && curDur >= minPrevSec && gap >= 0 && gap <= maxGapSec) {
      out[out.length - 1] = {
        ...cur,
        id: `${cur.id}-s-${next.id}`,
        endTime: Math.max(cur.endTime, next.endTime),
      };
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

/**
 * Heuristic suppression of harmonic false positives typical for acoustic piano mic.
 * - If a very short note is an octave above another near-simultaneous onset, drop the short higher one.
 */
export function suppressHarmonics(notes: DetectedNote[], onsetMs = 35): DetectedNote[] {
  if (notes.length === 0) return [];
  const sorted = sortByTime(notes);
  const th = onsetMs / 1000;
  const keep = new Array(sorted.length).fill(true) as boolean[];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const aDur = (a.endTime - a.startTime) * 1000;
    if (aDur >= 140) continue;
    for (let j = Math.max(0, i - 12); j < Math.min(sorted.length, i + 12); j++) {
      if (j === i) continue;
      const b = sorted[j]!;
      if (Math.abs(b.startTime - a.startTime) > th) continue;
      const diff = a.midi - b.midi;
      // a is the likely harmonic: +12 or +19 above
      if ((diff === 12 || diff === 19) && (b.endTime - b.startTime) * 1000 >= 120) {
        keep[i] = false;
        break;
      }
    }
  }
  return sorted.filter((_, idx) => keep[idx]);
}

export function deduplicateAgainstExisting(
  incoming: DetectedNote[],
  existing: DetectedNote[],
  thresholdMs = 200,
): DetectedNote[] {
  if (incoming.length === 0 || existing.length === 0) return incoming;
  const th = thresholdMs / 1000;
  return incoming.filter((n) => {
    return !existing.some(
      (e) => e.midi === n.midi && Math.abs(e.startTime - n.startTime) <= th,
    );
  });
}

export function sortByTime(notes: DetectedNote[]): DetectedNote[] {
  return [...notes].sort((a, b) => a.startTime - b.startTime);
}

export function postProcess(incoming: DetectedNote[], existing: DetectedNote[], minNoteMs = 35): DetectedNote[] {
  let n = filterShortNotes(incoming, minNoteMs);
  n = suppressHarmonics(n, 35);
  // For pedal-heavy piano, do a light sustain merge after strict legato.
  n = mergeLegato(n, 70);
  n = mergeSustain(n, 220, 120);
  n = deduplicateAgainstExisting(n, existing, 140);
  return sortByTime(n);
}
