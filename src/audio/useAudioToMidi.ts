import { requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { ExpoPlayAudioStreamNative, MicAudioChunk } from '../../types/audioNative';
import type { DetectedNote } from '../../types/notes';
import { mergeBuffers } from './audioUtils';
import { transcribeRemote } from './transcribeRemote';
import { chunkFromEvent } from './useMicrophone';

const MIC_CONFIG = {
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit' as const,
  interval: 100,
};

const START_MIC_TIMEOUT_MS = 14_000;

const TRANSCRIBE_API_URL =
  typeof process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL.trim()
    : '';

function getExpoPlayAudioStream(): ExpoPlayAudioStreamNative | null {
  if (Platform.OS === 'web') return null;
  if (requireOptionalNativeModule('ExpoPlayAudioStream') == null) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@edkimmel/expo-audio-stream') as { ExpoPlayAudioStream: ExpoPlayAudioStreamNative };
    return mod.ExpoPlayAudioStream ?? null;
  } catch {
    return null;
  }
}

export type AudioImportPhase = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export function useAudioToMidi(): {
  phase: AudioImportPhase;
  error: string | null;
  reset: () => void;
  startRecording: () => Promise<{ ok: true } | { ok: false; error: string }>;
  stopAndTranscribe: () => Promise<
    { ok: true; notes: DetectedNote[] } | { ok: false; error: string }
  >;
} {
  const [phase, setPhase] = useState<AudioImportPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const pcmChunksRef = useRef<Float32Array[]>([]);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const startAttemptIdRef = useRef(0);
  const micInFlightRef = useRef(false);
  const listeningRef = useRef(false);
  const sampleRateRef = useRef(44100);

  const stopMicAndSub = useCallback(() => {
    const ExpoPlayAudioStream = getExpoPlayAudioStream();
    const sub = subscriptionRef.current;
    subscriptionRef.current = null;
    try {
      sub?.remove();
    } catch {
      /* ignore */
    }
    if (ExpoPlayAudioStream) {
      void ExpoPlayAudioStream.stopMicrophone().catch(() => {});
    }
  }, []);

  const reset = useCallback(() => {
    micInFlightRef.current = false;
    startAttemptIdRef.current += 1;
    listeningRef.current = false;
    pcmChunksRef.current = [];
    stopMicAndSub();
    setPhase('idle');
    setError(null);
  }, [stopMicAndSub]);

  const startRecording = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (Platform.OS === 'web') {
      const msg = 'Microphone is not available on web in this build.';
      setError(msg);
      setPhase('error');
      return { ok: false, error: msg };
    }
    if (!TRANSCRIBE_API_URL) {
      const msg =
        'Set EXPO_PUBLIC_TRANSCRIBE_API_URL in .env to your Basic Pitch server URL (see docs/local-basic-pitch.md).';
      setError(msg);
      setPhase('error');
      return { ok: false, error: msg };
    }
    if (listeningRef.current) {
      return { ok: false, error: 'Recording is already in progress.' };
    }
    if (micInFlightRef.current) {
      return { ok: false, error: 'Microphone is already starting. Try again in a moment.' };
    }
    micInFlightRef.current = true;
    try {
      setError(null);

      const ExpoPlayAudioStream = getExpoPlayAudioStream();
      const missingModuleMsg =
        'PCM microphone module is not available. Use a dev build (npx expo run:android), not Expo Go.';
      if (!ExpoPlayAudioStream) {
        setError(missingModuleMsg);
        setPhase('error');
        return { ok: false, error: missingModuleMsg };
      }

      const perm = await ExpoPlayAudioStream.requestPermissionsAsync();
      if (!perm.granted) {
        const deniedMsg =
          'Microphone permission was denied. Enable it in system settings and try again.';
        setError(deniedMsg);
        setPhase('error');
        return { ok: false, error: deniedMsg };
      }

      if (subscriptionRef.current != null) {
        listeningRef.current = false;
        stopMicAndSub();
      }

      pcmChunksRef.current = [];
      const attemptId = ++startAttemptIdRef.current;
      listeningRef.current = true;

      try {
        const startPromise = ExpoPlayAudioStream.startMicrophone({
          ...MIC_CONFIG,
          onAudioStream: async (event: MicAudioChunk) => {
            if (attemptId !== startAttemptIdRef.current) return;
            try {
              const decoded = chunkFromEvent(event);
              if (decoded.length === 0) return;
              pcmChunksRef.current.push(decoded);
            } catch {
              /* ignore bad chunk */
            }
          },
        });

        const { subscription, recordingResult } = await Promise.race([
          startPromise,
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Microphone did not start in time. Close other audio apps and try again.'));
            }, START_MIC_TIMEOUT_MS);
          }),
        ]);

        if (attemptId !== startAttemptIdRef.current) {
          listeningRef.current = false;
          try {
            subscription?.remove();
          } catch {
            /* ignore */
          }
          void ExpoPlayAudioStream.stopMicrophone().catch(() => {});
          return { ok: false, error: 'Microphone start was superseded. Try again.' };
        }

        const rawSr = recordingResult?.sampleRate as number | string | undefined;
        const parsed =
          typeof rawSr === 'string'
            ? parseInt(rawSr, 10)
            : typeof rawSr === 'number' && Number.isFinite(rawSr)
              ? rawSr
              : NaN;
        const sampleRate =
          parsed === 16000 || parsed === 24000 || parsed === 44100 || parsed === 48000
            ? parsed
            : Platform.OS === 'android'
              ? 48000
              : MIC_CONFIG.sampleRate;
        sampleRateRef.current = sampleRate;

        subscriptionRef.current = subscription ?? null;
        setPhase('recording');
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attemptId === startAttemptIdRef.current) {
          startAttemptIdRef.current += 1;
          const err = msg || 'Failed to start microphone.';
          setError(err);
          setPhase('error');
          listeningRef.current = false;
          stopMicAndSub();
          return { ok: false, error: err };
        }
        listeningRef.current = false;
        return { ok: false, error: msg || 'Failed to start microphone.' };
      }
    } finally {
      micInFlightRef.current = false;
    }
  }, [stopMicAndSub]);

  const stopAndTranscribe = useCallback(async (): Promise<
    { ok: true; notes: DetectedNote[] } | { ok: false; error: string }
  > => {
    if (!TRANSCRIBE_API_URL) {
      const msg =
        'Set EXPO_PUBLIC_TRANSCRIBE_API_URL in .env to your Basic Pitch server URL (see docs/local-basic-pitch.md).';
      setError(msg);
      setPhase('error');
      return { ok: false, error: msg };
    }
    if (!listeningRef.current) {
      const msg = 'Not recording. Start recording first.';
      return { ok: false, error: msg };
    }

    micInFlightRef.current = false;
    startAttemptIdRef.current += 1;
    listeningRef.current = false;
    setPhase('processing');
    stopMicAndSub();

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const merged = mergeBuffers(chunks);
    if (merged.length === 0) {
      const msg = 'No audio captured.';
      setError(msg);
      setPhase('error');
      return { ok: false, error: msg };
    }

    const sr = sampleRateRef.current;
    const notes = await transcribeRemote(TRANSCRIBE_API_URL, merged, sr);
    if (notes == null || notes.length === 0) {
      const msg = 'Transcription failed or no notes were detected.';
      setError(msg);
      setPhase('error');
      return { ok: false, error: msg };
    }

    setError(null);
    setPhase('done');
    return { ok: true, notes };
  }, [stopMicAndSub]);

  return useMemo(
    () => ({
      phase,
      error,
      reset,
      startRecording,
      stopAndTranscribe,
    }),
    [phase, error, reset, startRecording, stopAndTranscribe],
  );
}
