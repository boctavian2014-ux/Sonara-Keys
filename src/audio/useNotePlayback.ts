import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DetectedNote } from '../../types/notes';
import { noteDurationMs, sortNotesByTime } from './midiUtils';
import { ToneSynth } from './ToneSynth';

const MIN_NOTE_MS = 150;
const MAX_NOTE_MS = 2000;

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

function clampDurationMs(raw: number): number {
  const v = Math.max(MIN_NOTE_MS, Math.min(MAX_NOTE_MS, raw));
  return Number.isFinite(v) ? v : MIN_NOTE_MS;
}

function timelineSpanMs(sorted: DetectedNote[]): number {
  if (sorted.length === 0) return 1;
  const t0 = sorted[0]!.startTime;
  const t1 = sorted[sorted.length - 1]!.endTime;
  return Math.max(1, (t1 - t0) * 1000);
}

export function useNotePlayback(notes: DetectedNote[]) {
  const sorted = useMemo(() => sortNotesByTime(notes), [notes]);
  const spanMs = useMemo(() => timelineSpanMs(sorted), [sorted]);

  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  const sortedRef = useRef(sorted);
  const spanRef = useRef(spanMs);
  sortedRef.current = sorted;
  spanRef.current = spanMs;

  const sessionRef = useRef(0);
  const resumeIndexRef = useRef(0);
  const pauseRequestedRef = useRef(false);
  const runningRef = useRef(false);

  const progressIvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playT0Ref = useRef(0);
  const elapsedBaseRef = useRef(0);

  const clearIv = useCallback(() => {
    if (progressIvRef.current != null) {
      clearInterval(progressIvRef.current);
      progressIvRef.current = null;
    }
  }, []);

  const sleepMs = useCallback((ms: number, token: number) => {
    return new Promise<boolean>((resolve) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (sessionRef.current !== token) {
          resolve(false);
          return;
        }
        if (Date.now() >= end) {
          resolve(true);
          return;
        }
        setTimeout(tick, 24);
      };
      tick();
    });
  }, []);

  const run = useCallback(async (mySession: number) => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      try {
        await ToneSynth.stopAll();
      } catch {
        /* ignore */
      }

      const list = sortedRef.current;
      if (list.length === 0 || sessionRef.current !== mySession) {
        setPlaybackState('idle');
        setCurrentPlayingIndex(null);
        return;
      }

      playT0Ref.current = Date.now();
      clearIv();
      progressIvRef.current = setInterval(() => {
        const span = spanRef.current;
        const elapsed = elapsedBaseRef.current + (Date.now() - playT0Ref.current);
        setProgress(Math.min(1, Math.max(0, elapsed / span)));
      }, 100);

      for (let i = resumeIndexRef.current; i < list.length; i++) {
        if (sessionRef.current !== mySession) break;

        while (pauseRequestedRef.current) {
          if (sessionRef.current !== mySession) break;
          await new Promise<void>((r) => setTimeout(r, 30));
        }
        if (sessionRef.current !== mySession) break;

        setCurrentPlayingIndex(i);

        if (i > 0) {
          const gapSec = list[i]!.startTime - list[i - 1]!.endTime;
          const ok = await sleepMs(Math.max(0, gapSec * 1000), mySession);
          if (!ok || sessionRef.current !== mySession) break;
        }

        const raw = noteDurationMs(list[i]!);
        const dur = clampDurationMs(raw);
        try {
          await ToneSynth.playNote(list[i]!.midi, dur);
        } catch {
          /* sound interrupted */
        }

        if (sessionRef.current !== mySession) break;

        if (pauseRequestedRef.current) {
          resumeIndexRef.current = i;
          clearIv();
          setPlaybackState('paused');
          return;
        }

        resumeIndexRef.current = i + 1;
      }

      clearIv();

      if (sessionRef.current === mySession) {
        if (resumeIndexRef.current >= list.length) {
          setCurrentPlayingIndex(null);
          setPlaybackState('stopped');
          setProgress(1);
          resumeIndexRef.current = 0;
          elapsedBaseRef.current = 0;
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [clearIv, sleepMs]);

  const play = useCallback(() => {
    if (sortedRef.current.length === 0) return;

    if (playbackState === 'paused') {
      pauseRequestedRef.current = false;
      setPlaybackState('playing');
      playT0Ref.current = Date.now();
      progressIvRef.current = setInterval(() => {
        const span = spanRef.current;
        const elapsed = elapsedBaseRef.current + (Date.now() - playT0Ref.current);
        setProgress(Math.min(1, Math.max(0, elapsed / span)));
      }, 100);
      void run(sessionRef.current);
      return;
    }

    sessionRef.current += 1;
    const mySession = sessionRef.current;
    pauseRequestedRef.current = false;
    resumeIndexRef.current = 0;
    elapsedBaseRef.current = 0;
    setProgress(0);
    setPlaybackState('playing');
    void (async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (sessionRef.current !== mySession) return;
      await run(mySession);
    })();
  }, [playbackState, run]);

  const pause = useCallback(() => {
    if (playbackState !== 'playing') return;
    pauseRequestedRef.current = true;
    void ToneSynth.stopAll();
    clearIv();
    elapsedBaseRef.current += Date.now() - playT0Ref.current;
    setPlaybackState('paused');
  }, [playbackState, clearIv]);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    pauseRequestedRef.current = false;
    void ToneSynth.stopAll();
    clearIv();
    resumeIndexRef.current = 0;
    setCurrentPlayingIndex(null);
    setPlaybackState('stopped');
    elapsedBaseRef.current = 0;
    setProgress(0);
  }, [clearIv]);

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      clearIv();
      void ToneSynth.stopAll();
    };
  }, [clearIv]);

  return {
    playbackState,
    currentPlayingIndex,
    play,
    pause,
    stop,
    progress,
  };
}
