import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicrophone } from './useMicrophone';
import { mergeBuffers, preprocessAudioAllowQuiet } from './audioUtils';
import { transcribeLocalPitch } from './localPitchTranscriber';
import { transcribeRemote } from './transcribeRemote';
import { postProcess } from './notePostProcess';
import { transcribeWindowRemote } from './transcribeWindowRemote';
import { normalizeExpoPublicApiBase } from './normalizeExpoPublicApiBase';
import type { DetectedNote } from '../../types/notes';

const TRANSCRIBE_API_URL = (() => {
  const raw =
    typeof process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL === 'string'
      ? process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL.trim()
      : '';
  if (!raw) return '';
  const n = normalizeExpoPublicApiBase(raw);
  if (!n.ok) {
    if (__DEV__) console.warn('[useNoteDetection] EXPO_PUBLIC_TRANSCRIBE_API_URL invalid:', n.error);
    return '';
  }
  return n.base;
})();

const USE_PIANO_GPU_STREAMING =
  typeof process.env.EXPO_PUBLIC_PIANO_GPU_STREAMING === 'string' &&
  process.env.EXPO_PUBLIC_PIANO_GPU_STREAMING.trim() === '1';

/** Set to `1` to skip TensorFlow Basic Pitch on the phone (much faster; worse on chords). */
const SKIP_ONDEVICE_BASIC_PITCH =
  typeof process.env.EXPO_PUBLIC_SKIP_ONDEVICE_BASIC_PITCH === 'string' &&
  process.env.EXPO_PUBLIC_SKIP_ONDEVICE_BASIC_PITCH.trim() === '1';

const TRANSCRIBE_TIMEOUT_MS = (() => {
  const raw =
    typeof process.env.EXPO_PUBLIC_TRANSCRIBE_TIMEOUT_MS === 'string'
      ? process.env.EXPO_PUBLIC_TRANSCRIBE_TIMEOUT_MS.trim()
      : '';
  const n = raw.length > 0 ? Number(raw) : 28_000;
  return Number.isFinite(n) && n > 3000 ? n : 28_000;
})();

const MIN_DURATION_SEC = 0.35;
/** Cap PCM sent to analysis — Basic Pitch+TFJS on device is heavy; keep this modest. */
const MAX_ANALYSIS_SEC = 8;

function parseEnvFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = typeof process.env[name] === 'string' ? process.env[name]!.trim() : '';
  const n = raw.length > 0 ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** GPU streaming only: smaller window = less WAV / faster inferență (mai puține 502 la proxy RunPod). */
const STREAM_WINDOW_SEC = parseEnvFloat('EXPO_PUBLIC_PIANO_GPU_WINDOW_SEC', 0.72, 0.4, 1.5);
const STREAM_HOP_SEC_RAW = parseEnvFloat('EXPO_PUBLIC_PIANO_GPU_HOP_SEC', 0.36, 0.18, 1.0);
const STREAM_HOP_SEC = Math.min(STREAM_HOP_SEC_RAW, STREAM_WINDOW_SEC * 0.85);

export function useNoteDetection() {
  const mic = useMicrophone();
  const [isModelLoaded] = useState(true);
  const [isStartingMic, setIsStartingMic] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<number | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [detectedNotes, setDetectedNotes] = useState<DetectedNote[]>([]);
  const [currentNote, setCurrentNote] = useState<DetectedNote | null>(null);
  const [sessionDurationSeconds, setSessionDurationSeconds] = useState(0);

  const detectedNotesRef = useRef<DetectedNote[]>([]);
  const sessionSampleRateRef = useRef(48000);
  const pcmBucketRef = useRef<Float32Array[]>([]);
  const analysisInFlightRef = useRef(false);
  const analysisRunIdRef = useRef(0);
  const listenWallStartRef = useRef(0);
  const captureEpochRef = useRef(0);
  const startLockRef = useRef(false);
  const streamSessionIdRef = useRef<string | null>(null);
  const streamNextAtWallMsRef = useRef(0);
  const streamRollingRef = useRef<Float32Array[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    detectedNotesRef.current = detectedNotes;
  }, [detectedNotes]);

  useEffect(() => {
    if (detectedNotes.length === 0) {
      setCurrentNote(null);
      return;
    }
    const sorted = [...detectedNotes].sort((a, b) => a.startTime - b.startTime);
    setCurrentNote(sorted[sorted.length - 1]!);
  }, [detectedNotes]);

  const clearNotes = useCallback(() => {
    setDetectedNotes([]);
    setCurrentNote(null);
  }, []);

  const cancelAnalysis = useCallback(() => {
    analysisRunIdRef.current += 1;
    pcmBucketRef.current = [];
    analysisInFlightRef.current = false;
    setIsProcessing(false);
    setTranscriptionProgress(null);
  }, []);

  const startListening = useCallback(async () => {
    if (startLockRef.current || mic.isListening) return;
    startLockRef.current = true;

    const epochAtStart = ++captureEpochRef.current;
    setTranscriptionError(null);
    cancelAnalysis();
    setIsStartingMic(true);
    try {
      pcmBucketRef.current = [];
      streamRollingRef.current = [];
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      streamSessionIdRef.current = `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      streamNextAtWallMsRef.current = 0;
      const micResult = await mic.startListening((chunk) => {
        if (epochAtStart !== captureEpochRef.current) return;
        pcmBucketRef.current.push(chunk);
        if (USE_PIANO_GPU_STREAMING) {
          streamRollingRef.current.push(chunk);
        }
      });
      if (epochAtStart !== captureEpochRef.current) {
        pcmBucketRef.current = [];
        await mic.stopListening();
        return;
      }
      if (!micResult.ok) {
        pcmBucketRef.current = [];
        setTranscriptionError(micResult.error ?? 'Microfon indisponibil.');
        return;
      }
      sessionSampleRateRef.current = micResult.sampleRate;
      listenWallStartRef.current = Date.now();
      streamNextAtWallMsRef.current = listenWallStartRef.current + STREAM_WINDOW_SEC * 1000;
    } finally {
      startLockRef.current = false;
      setIsStartingMic(false);
    }
  }, [cancelAnalysis, mic]);

  useEffect(() => {
    if (!USE_PIANO_GPU_STREAMING) return;
    if (!mic.isListening) return;
    const tStart = listenWallStartRef.current;
    if (tStart <= 0) return;

    let cancelled = false;
    const ac = new AbortController();
    streamAbortRef.current = ac;
    const lastGateway502LogMsRef = { v: 0 };

    const tick = async () => {
      if (cancelled || !mic.isListening) return;
      const now = Date.now();
      const nextAt = streamNextAtWallMsRef.current;
      if (nextAt <= 0 || now < nextAt) {
        setTimeout(() => void tick(), 60);
        return;
      }

      const sr = sessionSampleRateRef.current;
      const winSamples = Math.floor(STREAM_WINDOW_SEC * sr);
      const hopMs = STREAM_HOP_SEC * 1000;
      streamNextAtWallMsRef.current = nextAt + hopMs;

      // Merge rolling chunks and keep only last window
      const merged = mergeBuffers(streamRollingRef.current);
      const tail = merged.length > winSamples ? merged.subarray(merged.length - winSamples) : merged;
      // Trim rolling buffer to avoid growth
      streamRollingRef.current = [tail];

      const pre = preprocessAudioAllowQuiet(tail);
      const windowEndSec = Math.max(0, (nextAt - tStart) / 1000);
      const windowStartSec = Math.max(0, windowEndSec - STREAM_WINDOW_SEC);

      const sessionId = streamSessionIdRef.current;
      if (!sessionId) return;

      const r = await transcribeWindowRemote({
        sessionId,
        windowStartSec,
        pcm: pre,
        sampleRate: sr,
        signal: ac.signal,
      });
      if (!r.ok) {
        if (__DEV__) {
          const gateway = r.error.includes('502') || r.error.includes('503');
          const nowMs = Date.now();
          if (!gateway || nowMs - lastGateway502LogMsRef.v > 15_000) {
            console.warn('[useNoteDetection] transcribeWindowRemote', r.error);
            if (gateway) lastGateway502LogMsRef.v = nowMs;
          }
        }
        const backoffMs = r.error.includes('502') || r.error.includes('503') ? 2500 : 30;
        setTimeout(() => void tick(), backoffMs);
        return;
      }

      const processed = postProcess(r.notes, detectedNotesRef.current, 22);
      if (processed.length > 0) {
        setDetectedNotes((prev) => [...prev, ...processed].sort((a, b) => a.startTime - b.startTime));
      }

      setTimeout(() => void tick(), 30);
    };

    void tick();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [mic.isListening, mic.isListening]);

  const stopListening = useCallback(async () => {
    startLockRef.current = false;
    const t0 = listenWallStartRef.current;
    listenWallStartRef.current = 0;

    streamAbortRef.current?.abort();
    streamAbortRef.current = null;

    await mic.stopListening();
    if (t0 > 0) {
      setSessionDurationSeconds(Math.max(0, (Date.now() - t0) / 1000));
    }

    const chunks = pcmBucketRef.current;
    pcmBucketRef.current = [];
    captureEpochRef.current += 1;

    const sr = sessionSampleRateRef.current;

    if (analysisInFlightRef.current) return;
    if (chunks.length === 0) {
      setTranscriptionError(
        'Nu s-a captat niciun eșantion audio. Verifică microfonul, build-ul nativ (nu Expo Go) și încearcă din nou ~1s de cântat.',
      );
      return;
    }
    analysisInFlightRef.current = true;
    setIsProcessing(true);

    const minSamples = Math.floor(MIN_DURATION_SEC * sr);
    const runId = ++analysisRunIdRef.current;
    setTranscriptionProgress(0);

    void (async () => {
      try {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (runId !== analysisRunIdRef.current) return;
        const mergedFull = mergeBuffers(chunks);
        const maxSamples = Math.floor(MAX_ANALYSIS_SEC * sr);
        const merged =
          mergedFull.length > maxSamples ? mergedFull.subarray(mergedFull.length - maxSamples) : mergedFull;
        if (merged.length < minSamples) {
          if (runId === analysisRunIdRef.current) {
            setTranscriptionError(
              `Înregistrare prea scurtă (minim ~${MIN_DURATION_SEC}s). Ține apăsat și cântă mai mult.`,
            );
          }
          return;
        }

        const pre = preprocessAudioAllowQuiet(merged);
        if (runId !== analysisRunIdRef.current) return;

        const tAnalysis0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

        let raw: DetectedNote[] = [];
        if (TRANSCRIBE_API_URL.length > 0) {
          if (runId === analysisRunIdRef.current) setTranscriptionProgress(18);
          const ac = new AbortController();
          const tid = setTimeout(() => ac.abort(), TRANSCRIBE_TIMEOUT_MS);
          const tRemote0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
          try {
            const remote = await transcribeRemote(TRANSCRIBE_API_URL, pre, sr, ac.signal);
            if (remote && remote.length > 0) {
              raw = remote;
            }
          } catch (e) {
            if (__DEV__) console.warn('[useNoteDetection] transcribeRemote', e);
          } finally {
            clearTimeout(tid);
          }
          if (__DEV__) {
            const dt =
              (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tRemote0;
            console.log(`[useNoteDetection] remote path wallMs=${dt.toFixed(0)} notes=${raw.length}`);
          }
        }
        if (raw.length === 0) {
          if (runId === analysisRunIdRef.current) setTranscriptionProgress(6);
          raw = await transcribeLocalPitch(
            pre,
            sr,
            (pct) => {
              if (runId === analysisRunIdRef.current) {
                setTranscriptionProgress(Math.round(6 + pct * 44));
              }
            },
            () => runId !== analysisRunIdRef.current,
          );
        }
        if (raw.length === 0 && !SKIP_ONDEVICE_BASIC_PITCH) {
          try {
            if (runId === analysisRunIdRef.current) setTranscriptionProgress(52);
            const { runBasicPitchOnPcm } = await import('./basicPitchRunner');
            if (runId === analysisRunIdRef.current) setTranscriptionProgress(55);
            const bp = await runBasicPitchOnPcm(
              pre,
              sr,
              (pct) => {
                if (runId === analysisRunIdRef.current) {
                  setTranscriptionProgress(Math.round(55 + Math.min(1, Math.max(0, pct)) * 44));
                }
              },
            );
            if (bp.length > 0) raw = bp;
          } catch (e) {
            console.warn('[useNoteDetection] Basic Pitch on-device', e);
          }
        }
        if (runId === analysisRunIdRef.current && raw.length > 0) {
          setTranscriptionProgress(100);
        }

        if (runId !== analysisRunIdRef.current) return;
        if (__DEV__) {
          const total =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAnalysis0;
          console.log(`[useNoteDetection] analysis pipeline wallMs=${total.toFixed(0)} rawNotes=${raw.length}`);
        }
        const processed = postProcess(raw, detectedNotesRef.current, 22);
        if (processed.length === 0) {
          if (runId === analysisRunIdRef.current) {
            setTranscriptionError('Nu am detectat note clare. Încearcă mai aproape de pian și mai puțin zgomot.');
          }
          return;
        }
        if (runId !== analysisRunIdRef.current) return;
        setDetectedNotes((prev) => {
          const next = [...prev, ...processed].sort((a, b) => a.startTime - b.startTime);
          return next;
        });
      } catch (e) {
        console.error('[useNoteDetection] analysis', e);
        if (runId === analysisRunIdRef.current) {
          setTranscriptionError('Analiza a eșuat. Reîncearcă.');
        }
      } finally {
        analysisInFlightRef.current = false;
        setIsProcessing(false);
        setTranscriptionProgress(null);
      }
    })();
  }, [mic]);

  return {
    isListening: mic.isListening,
    isStartingMic,
    isModelLoaded,
    isProcessing,
    transcriptionProgress,
    transcriptionError,
    micError: mic.error,
    requestPermission: mic.requestPermission,
    detectedNotes,
    currentNote,
    sessionDurationSeconds,
    startListening,
    stopListening,
    cancelAnalysis,
    clearNotes,
  };
}
