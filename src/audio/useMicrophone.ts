import { requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { ExpoPlayAudioStreamNative, MicAudioChunk } from '../../types/audioNative';

const MIC_CONFIG = {
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit' as const,
  interval: 100,
};

/** If native `startMicrophone` never resolves, we fail fast instead of a stuck UI. */
const START_MIC_TIMEOUT_MS = 14_000;

export function decodeBase64PCM(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const evenBytes = bytes.byteLength & ~1;
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, evenBytes / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i]! / 32768.0;
  return float32;
}

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

function floatFromArrayBuffer(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const sampleCount = Math.floor(view.byteLength / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768.0;
  }
  return out;
}

export function chunkFromEvent(event: MicAudioChunk): Float32Array {
  const e = event as MicAudioChunk & {
    encoded?: string | Float32Array | number[] | ArrayBuffer;
    audioData?: string | Float32Array | number[] | ArrayBuffer;
    pcmData?: string | Float32Array | number[] | ArrayBuffer;
  };
  const raw =
    event.data ??
    e.encoded ??
    e.audioData ??
    e.pcmData;
  if (typeof raw === 'string') return decodeBase64PCM(raw);
  const u: unknown = raw;
  if (u instanceof Float32Array) return u;
  if (u instanceof ArrayBuffer) return floatFromArrayBuffer(u);
  if (Array.isArray(u)) return Float32Array.from(u);
  return new Float32Array(0);
}

export type MicStartResult =
  | { ok: true; sampleRate: number }
  | { ok: false; error?: string };

export function useMicrophone(): {
  isListening: boolean;
  permissionGranted: boolean;
  error: string | null;
  clearError: () => void;
  requestPermission: () => Promise<void>;
  startListening: (onChunk: (samples: Float32Array) => void) => Promise<MicStartResult>;
  stopListening: () => Promise<void>;
} {
  const [isListening, setIsListening] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const onChunkRef = useRef<(samples: Float32Array) => void>(() => {});
  const listeningRef = useRef(false);
  /** Bumps when a new start is attempted or mic stops, so late `startMicrophone` resolves are ignored. */
  const startAttemptIdRef = useRef(0);
  /** Prevents overlapping `startMicrophone` calls (double-tap / race). */
  const micInFlightRef = useRef(false);

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

  const requestPermission = useCallback(async () => {
    if (Platform.OS === 'web') {
      setPermissionGranted(false);
      return;
    }
    const ExpoPlayAudioStream = getExpoPlayAudioStream();
    if (!ExpoPlayAudioStream) {
      setPermissionGranted(false);
      return;
    }
    const perm = await ExpoPlayAudioStream.requestPermissionsAsync();
    setPermissionGranted(perm.granted);
  }, []);

  const startListening = useCallback(
    async (onChunk: (samples: Float32Array) => void): Promise<MicStartResult> => {
      if (Platform.OS === 'web') {
        return { ok: false, error: 'Microphone is not available on web in this build.' };
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
        setPermissionGranted(false);
        setError(missingModuleMsg);
        return { ok: false, error: missingModuleMsg };
      }

      const perm = await ExpoPlayAudioStream.requestPermissionsAsync();
      if (!perm.granted) {
        setPermissionGranted(false);
        const deniedMsg =
          'Microphone permission was denied. Enable it in system settings and try again.';
        setError(deniedMsg);
        return { ok: false, error: deniedMsg };
      }
      setPermissionGranted(true);

      if (subscriptionRef.current != null) {
        listeningRef.current = false;
        setIsListening(false);
        stopMicAndSub();
      }

      onChunkRef.current = onChunk;

      const attemptId = ++startAttemptIdRef.current;
      /** Must be true before `await startMicrophone` — native can emit PCM in the same tick as resolve. */
      listeningRef.current = true;

      try {
        const startPromise = ExpoPlayAudioStream.startMicrophone({
          ...MIC_CONFIG,
          onAudioStream: async (event: MicAudioChunk) => {
            if (attemptId !== startAttemptIdRef.current) return;
            try {
              const decoded = chunkFromEvent(event);
              if (decoded.length === 0) return;
              onChunkRef.current(decoded);
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

        subscriptionRef.current = subscription ?? null;
        setIsListening(true);
        return { ok: true, sampleRate };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attemptId === startAttemptIdRef.current) {
          startAttemptIdRef.current += 1;
          const err = msg || 'Failed to start microphone.';
          setError(err);
          listeningRef.current = false;
          setIsListening(false);
          stopMicAndSub();
          return { ok: false, error: err };
        }
        listeningRef.current = false;
        return { ok: false };
      }
      } finally {
        micInFlightRef.current = false;
      }
    },
    [stopMicAndSub],
  );

  const stopListening = useCallback(async () => {
    micInFlightRef.current = false;
    startAttemptIdRef.current += 1;
    listeningRef.current = false;
    setIsListening(false);
    stopMicAndSub();
  }, [stopMicAndSub]);

  return useMemo(
    () => ({
      isListening,
      permissionGranted,
      error,
      clearError,
      requestPermission,
      startListening,
      stopListening,
    }),
    [isListening, permissionGranted, error, clearError, requestPermission, startListening, stopListening],
  );
}
