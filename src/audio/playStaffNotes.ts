import type { DetectedNote } from '../../types/notes';
import { ToneSynth } from './ToneSynth';

const MIN_NOTE_MS = 85;
const MAX_NOTE_MS = 950;

function noteDurationMs(n: DetectedNote): number {
  const raw = Math.round((n.endTime - n.startTime) * 1000);
  if (!Number.isFinite(raw) || raw <= 0) return 220;
  return Math.max(MIN_NOTE_MS, Math.min(MAX_NOTE_MS, raw));
}

export type PlayStaffNotesOptions = {
  /** 1 = real-time from note timestamps; lower = faster preview. */
  timeScale?: number;
  onHighlight?: (noteId: string | null) => void;
  signal?: AbortSignal;
};

/**
 * Plays session notes in chronological order using ToneSynth, aligned to startTime (scaled).
 * Notes that overlap in time still start at their respective scheduled times.
 */
export function playStaffNotesSequence(notes: DetectedNote[], options: PlayStaffNotesOptions = {}): Promise<void> {
  const { timeScale = 1, onHighlight, signal } = options;
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  if (sorted.length === 0) {
    onHighlight?.(null);
    return Promise.resolve();
  }

  const t0 = sorted[0]!.startTime;
  const last = sorted[sorted.length - 1]!;
  const spanSec = Math.max(0, last.endTime - t0);
  const tailMs = 450;

  return new Promise((resolve) => {
    let finished = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const done = () => {
      if (finished) return;
      finished = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      onHighlight?.(null);
      resolve();
    };

    const onAbort = () => {
      for (const id of timeouts) clearTimeout(id);
      timeouts.length = 0;
      void ToneSynth.stopAll();
      done();
    };

    if (signal?.aborted) {
      onHighlight?.(null);
      resolve();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      try {
        await ToneSynth.preload();
      } catch {
        done();
        return;
      }
      if (signal?.aborted) {
        onAbort();
        return;
      }

      for (const n of sorted) {
        const delayMs = Math.max(0, (n.startTime - t0) * 1000 * timeScale);
        const tid = setTimeout(() => {
          if (signal?.aborted) return;
          onHighlight?.(n.id);
          void ToneSynth.playNote(n.midi, noteDurationMs(n));
        }, delayMs);
        timeouts.push(tid);
      }

      const endMs = spanSec * 1000 * timeScale + tailMs;
      timeouts.push(
        setTimeout(() => {
          if (signal?.aborted) return;
          done();
        }, endMs),
      );
    })();
  });
}
