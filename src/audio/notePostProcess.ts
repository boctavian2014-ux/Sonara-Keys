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
  n = mergeLegato(n);
  n = deduplicateAgainstExisting(n, existing);
  return sortByTime(n);
}
