import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicrophone } from './useMicrophone';
import { mergeBuffers, preprocessAudioAllowQuiet } from './audioUtils';
import { transcribeLocalPitch } from './localPitchTranscriber';
import { transcribeRemote } from './transcribeRemote';
import { postProcess } from './notePostProcess';
import type { DetectedNote } from '../../types/notes';

const TRANSCRIBE_API_URL =
  typeof process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL.trim()
    : '';

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
      const micResult = await mic.startListening((chunk) => {
        if (epochAtStart !== captureEpochRef.current) return;
        pcmBucketRef.current.push(chunk);
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
    } finally {
      startLockRef.current = false;
      setIsStartingMic(false);
    }
  }, [cancelAnalysis, mic]);

  const stopListening = useCallback(async () => {
    startLockRef.current = false;
    const t0 = listenWallStartRef.current;
    listenWallStartRef.current = 0;

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
