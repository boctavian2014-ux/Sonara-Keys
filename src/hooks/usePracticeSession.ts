import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';

import { ToneSynth } from '../audio/ToneSynth';
import { frequencyToNoteName } from '../../audio/pitchDetector';
import { useAudioPitch } from '../../hooks/useAudioPitch';
import type { PracticeNote } from '../data/melodies';
import { practiceNoteDurationMs } from '../data/melodies';

const SEMITONE_TOLERANCE = 1;
const DEBOUNCE_MS = 120;
const ADVANCE_MS = 600;
const WRONG_RESET_MS = 900;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clearTimerList(ids: ReturnType<typeof setTimeout>[]) {
  for (const id of ids) clearTimeout(id);
  ids.length = 0;
}

export type PracticeStatus = 'idle' | 'listening' | 'correct' | 'wrong' | 'complete';

export type PracticeScore = { correct: number; total: number };

export type UsePracticeSessionResult = {
  melody: PracticeNote[];
  currentIndex: number;
  status: PracticeStatus;
  detectedMidi: number | null;
  score: PracticeScore;
  streak: number;
  expectedMidi: number | null;
  restart: () => void;
  submitDetectedMidi: (midi: number) => void;
  micError: string | null;
  isMicListening: boolean;
  soundEnabled: boolean;
  toggleSound: () => void;
  autoMode: boolean;
  toggleAutoMode: () => void;
  startAutoPlay: () => Promise<void>;
  stopAutoPlay: () => void;
};

export function usePracticeSession(melody: PracticeNote[]): UsePracticeSessionResult {
  const {
    isListening,
    error: micError,
    currentHz,
    startListening,
    stopListening,
  } = useAudioPitch();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<PracticeStatus>(() => (Platform.OS === 'web' ? 'idle' : 'listening'));
  const [detectedMidi, setDetectedMidi] = useState<number | null>(null);
  const [score, setScore] = useState<PracticeScore>({ correct: 0, total: melody.length });
  const [streak, setStreak] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoMode, setAutoMode] = useState(false);

  const currentIndexRef = useRef(currentIndex);
  const statusRef = useRef(status);
  const soundEnabledRef = useRef(soundEnabled);
  const autoModeRef = useRef(autoMode);
  const autoStoppedRef = useRef(false);

  currentIndexRef.current = currentIndex;
  statusRef.current = status;
  soundEnabledRef.current = soundEnabled;
  autoModeRef.current = autoMode;

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pitchRef = useRef({ startListening, stopListening });
  pitchRef.current = { startListening, stopListening };

  const melodyLen = melody.length;

  const expectedMidi = useMemo(() => {
    if (currentIndex >= melodyLen) return null;
    return melody[currentIndex]?.midi ?? null;
  }, [currentIndex, melody, melodyLen]);

  const expectedMidiRef = useRef(expectedMidi);
  expectedMidiRef.current = expectedMidi;

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const correctLockRef = useRef(false);
  const wrongLockRef = useRef(false);

  const advanceAfterCorrect = useCallback(() => {
    const idx = currentIndexRef.current;
    const next = idx + 1;
    setScore((s) => ({ ...s, correct: s.correct + 1 }));
    setStreak((st) => st + 1);
    setDetectedMidi(null);
    if (next >= melodyLen) {
      setStatus('complete');
      setCurrentIndex(melodyLen);
      correctLockRef.current = false;
      void pitchRef.current.stopListening();
    } else {
      setCurrentIndex(next);
      setStatus('listening');
      correctLockRef.current = false;
      wrongLockRef.current = false;
    }
  }, [melodyLen]);

  const handleCorrect = useCallback(() => {
    if (statusRef.current === 'correct' || statusRef.current === 'complete') return;
    if (correctLockRef.current) return;
    correctLockRef.current = true;
    setStatus('correct');
    Vibration.vibrate(40);

    const idx = currentIndexRef.current;
    const exp = expectedMidiRef.current;
    const note = idx < melodyLen ? melody[idx] : undefined;
    if (soundEnabledRef.current && exp != null && note) {
      const dur = practiceNoteDurationMs(note);
      void (async () => {
        await ToneSynth.playNote(exp, dur);
        await delay(200);
        await ToneSynth.playNote(exp + 12, 200);
      })();
    }

    clearTimerList(timersRef.current);
    schedule(() => {
      advanceAfterCorrect();
    }, ADVANCE_MS);
  }, [advanceAfterCorrect, melody, melodyLen, schedule]);

  const handleWrong = useCallback(
    (wrongMidi: number) => {
      if (statusRef.current === 'complete') return;
      if (wrongLockRef.current) return;
      wrongLockRef.current = true;
      setStatus('wrong');
      setStreak(0);
      Vibration.vibrate([0, 60, 80, 60]);
      if (soundEnabledRef.current) {
        void ToneSynth.playNote(wrongMidi, 80);
      }
      clearTimerList(timersRef.current);
      schedule(() => {
        wrongLockRef.current = false;
        setStatus('listening');
        setDetectedMidi(null);
      }, WRONG_RESET_MS);
    },
    [schedule],
  );

  const evaluateMidi = useCallback(
    (midi: number | null) => {
      if (midi == null) return;
      if (autoModeRef.current) return;
      const st = statusRef.current;
      if (st === 'complete' || st === 'correct') return;
      if (st !== 'listening') return;
      const exp = expectedMidiRef.current;
      if (exp == null) return;
      const diff = Math.abs(midi - exp);
      if (diff <= SEMITONE_TOLERANCE) {
        handleCorrect();
      } else {
        handleWrong(midi);
      }
    },
    [handleCorrect, handleWrong],
  );

  const submitDetectedMidi = useCallback(
    (midi: number) => {
      if (autoModeRef.current) return;
      setDetectedMidi(midi);
      evaluateMidi(midi);
    },
    [evaluateMidi],
  );

  const stopAutoPlay = useCallback(() => {
    autoStoppedRef.current = true;
    void ToneSynth.stopAll();
    setAutoMode(false);
    if (statusRef.current !== 'complete') {
      setStatus('listening');
    }
    if (Platform.OS !== 'web' && statusRef.current !== 'complete') {
      void pitchRef.current.startListening();
    }
  }, []);

  const startAutoPlay = useCallback(async () => {
    autoStoppedRef.current = false;
    setAutoMode(true);
    setStatus('listening');
    clearTimerList(timersRef.current);
    correctLockRef.current = false;
    wrongLockRef.current = false;
    setDetectedMidi(null);
    await ToneSynth.stopAll();
    if (Platform.OS !== 'web') {
      void pitchRef.current.stopListening();
    }

    for (let i = currentIndexRef.current; i < melodyLen; i++) {
      if (autoStoppedRef.current) break;
      setCurrentIndex(i);
      const note = melody[i];
      if (!note) break;
      const dur = Math.max(400, practiceNoteDurationMs(note));
      await ToneSynth.playNote(note.midi, dur);
      if (autoStoppedRef.current) break;
      await delay(300);
    }

    if (!autoStoppedRef.current) {
      setStatus('complete');
      setCurrentIndex(melodyLen);
      if (Platform.OS !== 'web') {
        void pitchRef.current.stopListening();
      }
    } else if (Platform.OS !== 'web' && currentIndexRef.current < melodyLen) {
      void pitchRef.current.startListening();
    }
    setAutoMode(false);
  }, [melody, melodyLen]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => !v);
  }, []);

  const toggleAutoMode = useCallback(() => {
    if (autoMode) {
      stopAutoPlay();
    } else {
      void startAutoPlay();
    }
  }, [autoMode, startAutoPlay, stopAutoPlay]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (micError) return;
    const blocked = autoMode || status === 'complete';
    if (blocked) {
      void pitchRef.current.stopListening();
    } else {
      void pitchRef.current.startListening();
    }
    return () => {
      void pitchRef.current.stopListening();
    };
  }, [autoMode, status === 'complete', micError]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!soundEnabled) return;
    if (autoMode) return;
    if (status === 'complete') return;
    if (currentIndex >= melodyLen) return;
    const n = melody[currentIndex];
    if (!n) return;
    void ToneSynth.playNote(n.midi, 400);
  }, [currentIndex, soundEnabled, autoMode, status, melody, melodyLen]);

  useEffect(() => {
    if (!isListening || Platform.OS === 'web') return;
    if (autoMode) return;
    const id = setTimeout(() => {
      if (autoModeRef.current) return;
      if (statusRef.current === 'correct' || statusRef.current === 'complete') return;
      if (currentHz == null || !Number.isFinite(currentHz) || currentHz <= 0) {
        setDetectedMidi(null);
        return;
      }
      const m = frequencyToNoteName(currentHz).midi;
      setDetectedMidi(m);
      evaluateMidi(m);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [autoMode, currentHz, evaluateMidi, isListening]);

  const restart = useCallback(() => {
    autoStoppedRef.current = true;
    void ToneSynth.stopAll();
    setAutoMode(false);
    clearTimerList(timersRef.current);
    correctLockRef.current = false;
    wrongLockRef.current = false;
    setCurrentIndex(0);
    setStatus(Platform.OS === 'web' ? 'idle' : 'listening');
    setDetectedMidi(null);
    setScore({ correct: 0, total: melodyLen });
    setStreak(0);
    if (Platform.OS !== 'web') {
      void pitchRef.current.stopListening();
      void pitchRef.current.startListening();
    }
  }, [melodyLen]);

  // Cleanup on unmount: stop all resources
  useEffect(() => {
    return () => {
      clearTimerList(timersRef.current);
      void ToneSynth.stopAll();
      autoStoppedRef.current = true;
      if (Platform.OS !== 'web') {
        void pitchRef.current.stopListening();
      }
    };
  }, []);

  return {
    melody,
    currentIndex,
    status,
    detectedMidi,
    score,
    streak,
    expectedMidi,
    restart,
    submitDetectedMidi,
    micError,
    isMicListening: isListening,
    soundEnabled,
    toggleSound,
    autoMode,
    toggleAutoMode,
    startAutoPlay,
    stopAutoPlay,
  };
}
