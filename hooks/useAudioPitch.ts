import { requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  createEmptySegmentationRefs,
  medianMidi,
  MIDI_MEDIAN_LEN,
  stepSegmentation,
  type SegmentationRefs,
} from '../audio/noteSegmentation';
import {
  frequencyToNoteName,
  midiToLabel,
  pcm16Base64ToFloat32,
  rmsEnergy,
  smoothHz,
  yinDetectPitch,
} from '../audio/pitchDetector';
import type { DetectedNote } from '../types/notes';
import type { ExpoPlayAudioStreamNative, MicAudioChunk } from '../types/audioNative';

function getExpoPlayAudioStream(): ExpoPlayAudioStreamNative | null {
  if (Platform.OS === 'web') return null;
  // Evită `require('@edkimmel/...')` când nativul lipsește: acel pachet apelează `requireNativeModule` la încărcare și loghează ERROR în Expo Go.
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

/** ~46 ms @ 44,1 kHz — mai rapid decât 4096, puțin mai zgomotos. */
const ANALYSIS_WINDOW = 2048;
/** Ușor mai jos = pitch mai des detectat pe volum mic (risc falsuri). */
const YIN_THRESHOLD = 0.15;
/** Ușor mai jos = note mai „sensibile”; risc de falsuri în tăcere scurtă. */
const RMS_GATE = 0.003;
/** Mai mic = urmărire mai rapidă a Hz; mai nervos vizual fără throttle. */
const HZ_SMOOTH = 0.3;
/** Note foarte scurte nu se desenează; prea mare = pierzi staccato. */
const MIN_NOTE_MS = 55;
const RELEASE_FRAMES = 4;

/** Interval minim între actualizări Hz/etichetă în React (reduce re-render-uri). */
const UI_FLUSH_MS = 48;
/** Cât de des actualizăm endTime-ul notei „live” pe portativ. */
const EXTEND_FLUSH_MS = 72;

const NATIVE_PCM_INTERVAL_MS = 16;
/** Max ~90 s mono @44,1kHz pentru Basic Pitch (~16 Mo). */
const MAX_RECORD_SAMPLES = 44100 * 90;

function eventToMonoFloat(event: MicAudioChunk): Float32Array {
  if (typeof event.data === 'string') return pcm16Base64ToFloat32(event.data);
  return event.data as Float32Array;
}

function pushOverlapBuffer(tail: Float32Array, chunk: Float32Array): { tail: Float32Array; windows: Float32Array[] } {
  const combined = new Float32Array(tail.length + chunk.length);
  combined.set(tail, 0);
  combined.set(chunk, tail.length);
  const windows: Float32Array[] = [];
  let offset = 0;
  const hop = Math.floor(ANALYSIS_WINDOW / 2);
  while (offset + ANALYSIS_WINDOW <= combined.length) {
    windows.push(new Float32Array(combined.subarray(offset, offset + ANALYSIS_WINDOW)));
    offset += hop;
  }
  const keepFrom = Math.max(0, combined.length - ANALYSIS_WINDOW * 2);
  const newTail = new Float32Array(combined.subarray(keepFrom));
  return { tail: newTail, windows };
}

export type UseAudioPitchResult = {
  isListening: boolean;
  status: string;
  error: string | null;
  currentHz: number | null;
  currentLabel: string | null;
  detectedNotes: DetectedNote[];
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  /** Există înregistrare după ultimul Stop (poți rula Basic Pitch). */
  hasFrozenRecording: boolean;
  transcribeProgress: number | null;
  transcribeError: string | null;
  transcribeFromRecording: () => Promise<void>;
  /** Dacă e true, după Stop pornește automat Basic Pitch pe înregistrare. */
  autoTranscribeOnStop: boolean;
  setAutoTranscribeOnStop: (value: boolean) => void;
};

export function useAudioPitch(): UseAudioPitchResult {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('Stopped');
  const [error, setError] = useState<string | null>(null);
  const [currentHz, setCurrentHz] = useState<number | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [detectedNotes, setDetectedNotes] = useState<DetectedNote[]>([]);
  const [hasFrozenRecording, setHasFrozenRecording] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<number | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [autoTranscribeOnStop, setAutoTranscribeOnStop] = useState(false);

  const stoppingRef = useRef(false);
  /** Sincron cu microfonul real; folosit ca Stop să fie idempotent fără să depindă de re-render. */
  const isListeningRef = useRef(false);
  const sampleRateRef = useRef(44100);
  const recordBufRef = useRef<Float32Array | null>(null);
  const recordLenRef = useRef(0);
  const frozenSamplesRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null);
  const tailRef = useRef(new Float32Array(0));
  const hzSmoothRef = useRef<number | null>(null);
  const midiRingRef = useRef<number[]>([]);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);

  const segRef = useRef<SegmentationRefs>(createEmptySegmentationRefs());
  const releaseCountRef = useRef(0);
  const liveIdRef = useRef<string | null>(null);

  const pendingHzRef = useRef<number | null>(null);
  const lastUiFlushRef = useRef(0);

  const pendingExtendMsRef = useRef<number | null>(null);
  const extendFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExtendTimer = useCallback(() => {
    if (extendFlushTimerRef.current != null) {
      clearTimeout(extendFlushTimerRef.current);
      extendFlushTimerRef.current = null;
    }
  }, []);

  const flushExtendNow = useCallback(() => {
    clearExtendTimer();
    const t = pendingExtendMsRef.current;
    const id = liveIdRef.current;
    if (t == null || !id) return;
    setDetectedNotes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last || last.id !== id) return prev;
      if (last.endTime === t) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = { ...last, endTime: t };
      return copy;
    });
  }, [clearExtendTimer]);

  const scheduleExtendFlush = useCallback(() => {
    if (extendFlushTimerRef.current != null) return;
    extendFlushTimerRef.current = setTimeout(() => {
      extendFlushTimerRef.current = null;
      const t = pendingExtendMsRef.current;
      const id = liveIdRef.current;
      if (t == null || !id) return;
      setDetectedNotes((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (!last || last.id !== id) return prev;
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, endTime: t };
        return copy;
      });
    }, EXTEND_FLUSH_MS);
  }, []);

  const flushDisplayIfDue = useCallback(() => {
    const now = Date.now();
    if (now - lastUiFlushRef.current < UI_FLUSH_MS) return;
    lastUiFlushRef.current = now;
    setCurrentHz(pendingHzRef.current);
  }, []);

  const resetBuffers = useCallback(() => {
    clearExtendTimer();
    tailRef.current = new Float32Array(0);
    hzSmoothRef.current = null;
    midiRingRef.current = [];
    segRef.current = createEmptySegmentationRefs();
    releaseCountRef.current = 0;
    liveIdRef.current = null;
    pendingHzRef.current = null;
    pendingExtendMsRef.current = null;
    lastUiFlushRef.current = 0;
    setCurrentHz(null);
    setCurrentLabel(null);
  }, [clearExtendTimer]);

  const closeLiveNote = useCallback(
    (endMs: number, opts?: { preserveSeg?: boolean }) => {
      flushExtendNow();
      const id = liveIdRef.current;
      if (!id) return;
      setDetectedNotes((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (!last || last.id !== id) return prev;
        const dur = endMs - last.startTime;
        if (dur < MIN_NOTE_MS) return prev.slice(0, -1);
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, endTime: endMs };
        return copy;
      });
      liveIdRef.current = null;
      if (!opts?.preserveSeg) {
        segRef.current = createEmptySegmentationRefs();
      }
      setCurrentLabel(null);
      pendingHzRef.current = null;
      lastUiFlushRef.current = Date.now();
      setCurrentHz(null);
    },
    [flushExtendNow],
  );

  const openNewNote = useCallback(
    (midi: number, tMs: number) => {
      flushExtendNow();
      const { name, octave } = frequencyToNoteName(440 * 2 ** ((midi - 69) / 12));
      const id = `${tMs}-${midi}-${Math.random().toString(36).slice(2, 7)}`;
      liveIdRef.current = id;
      const note: DetectedNote = { id, name, octave, midi, startTime: tMs, endTime: tMs };
      setDetectedNotes((prev) => [...prev, note]);
      setCurrentLabel(midiToLabel(midi));
      lastUiFlushRef.current = Date.now();
      setCurrentHz(pendingHzRef.current);
    },
    [flushExtendNow],
  );

  const processWindows = useCallback(
    (windows: Float32Array[], streamTimeMs: number) => {
      const sr = sampleRateRef.current;

      for (const w of windows) {
        const rawHz = yinDetectPitch(w, sr, YIN_THRESHOLD);
        const rms = rmsEnergy(w);
        const hz = smoothHz(hzSmoothRef.current, rawHz, HZ_SMOOTH);
        hzSmoothRef.current = hz;

        if (hz == null || rms < RMS_GATE) {
          releaseCountRef.current += 1;
          if (releaseCountRef.current >= RELEASE_FRAMES && liveIdRef.current) {
            closeLiveNote(streamTimeMs);
          }
          pendingHzRef.current = null;
          flushDisplayIfDue();
          continue;
        }

        releaseCountRef.current = 0;
        pendingHzRef.current = hz;

        const { midi } = frequencyToNoteName(hz);
        const ring = midiRingRef.current;
        ring.push(midi);
        if (ring.length > MIDI_MEDIAN_LEN) ring.shift();
        const med = medianMidi(ring);

        const { next, effect } = stepSegmentation(segRef.current, med);
        segRef.current = next;

        switch (effect.type) {
          case 'none':
            break;
          case 'open':
            openNewNote(effect.midi, streamTimeMs);
            break;
          case 'extend':
            pendingExtendMsRef.current = streamTimeMs;
            scheduleExtendFlush();
            break;
          case 'closeAndOpen':
            closeLiveNote(streamTimeMs, { preserveSeg: true });
            openNewNote(effect.newMidi, streamTimeMs);
            break;
          default:
            break;
        }

        flushDisplayIfDue();
      }
    },
    [closeLiveNote, flushDisplayIfDue, openNewNote, scheduleExtendFlush],
  );

  const startListening = useCallback(async () => {
    setError(null);
    if (Platform.OS === 'web') {
      setError(
        'Pentru acest MVP, captura PCM în timp real folosește module native (@edkimmel/expo-audio-stream). Rulează pe Android sau iOS (development build sau `npx expo run:android` / `run:ios`).',
      );
      return;
    }

    const ExpoPlayAudioStream = getExpoPlayAudioStream();
    if (!ExpoPlayAudioStream) {
      isListeningRef.current = false;
      setError(
        'Microfonul în timp real nu merge în Expo Go (lipsește modulul nativ ExpoPlayAudioStream). Pe telefon: oprește Expo Go, rulează pe PC `npx expo run:android` (USB + depurare), apoi deschide aplicația instalată „Sonara Keys”, nu Expo Go.',
      );
      setStatus('Stopped');
      return;
    }

    const perm = await ExpoPlayAudioStream.requestPermissionsAsync();
    if (!perm.granted) {
      isListeningRef.current = false;
      setError('Permisiunea pentru microfon a fost refuzată.');
      setStatus('Stopped');
      return;
    }

    resetBuffers();
    setDetectedNotes([]);
    frozenSamplesRef.current = null;
    setHasFrozenRecording(false);
    setTranscribeError(null);
    recordBufRef.current = new Float32Array(MAX_RECORD_SAMPLES);
    recordLenRef.current = 0;

    try {
      const { recordingResult, subscription } = await ExpoPlayAudioStream.startMicrophone({
        sampleRate: 44100,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: NATIVE_PCM_INTERVAL_MS,
        onAudioStream: async (event: MicAudioChunk) => {
          if (stoppingRef.current) return;
          const chunk = new Float32Array(eventToMonoFloat(event));
          const rb = recordBufRef.current;
          if (rb) {
            const w = recordLenRef.current;
            const room = rb.length - w;
            if (room > 0) {
              const n = Math.min(chunk.length, room);
              rb.set(chunk.subarray(0, n), w);
              recordLenRef.current = w + n;
            }
          }
          const { tail, windows } = pushOverlapBuffer(tailRef.current, chunk);
          tailRef.current = new Float32Array(tail);
          const t = typeof event.position === 'number' ? event.position : Date.now();
          if (windows.length > 0) processWindows(windows, t);
        },
      });

      sampleRateRef.current = recordingResult.sampleRate ?? 44100;
      subscriptionRef.current = subscription ?? null;
      stoppingRef.current = false;
      isListeningRef.current = true;
      setIsListening(true);
      setStatus('Listening…');
    } catch (e) {
      stoppingRef.current = false;
      isListeningRef.current = false;
      recordBufRef.current = null;
      recordLenRef.current = 0;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('Stopped');
    }
  }, [processWindows, resetBuffers]);

  const transcribeFromRecording = useCallback(async () => {
    setTranscribeError(null);
    const fr = frozenSamplesRef.current;
    if (!fr || fr.samples.length === 0) {
      setTranscribeError('Nu există audio înregistrat. Pornește ascultarea, cântă, apoi Stop.');
      return;
    }
    setTranscribeProgress(0);
    try {
      const { transcribePcmToDetectedNotes } = await import('../audio/basicPitchTranscribe');
      const notes = await transcribePcmToDetectedNotes(fr.samples, fr.sampleRate, (p) => {
        setTranscribeProgress(Math.round(p * 100));
      });
      setDetectedNotes(notes);
      frozenSamplesRef.current = null;
      setHasFrozenRecording(false);
      setTranscribeProgress(null);
      setStatus('Transcriere gata');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTranscribeError(msg);
      setTranscribeProgress(null);
      setStatus('Stopped');
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (Platform.OS === 'web') {
      isListeningRef.current = false;
      setIsListening(false);
      setStatus('Stopped');
      return;
    }

    if (!isListeningRef.current) return;

    stoppingRef.current = true;
    isListeningRef.current = false;

    let runAutoTranscribe = false;

    try {
      setIsListening(false);
      setStatus('Stopped');

      const ExpoPlayAudioStream = getExpoPlayAudioStream();
      flushExtendNow();

      const rb = recordBufRef.current;
      const rlen = recordLenRef.current;
      if (rb && rlen > 0) {
        frozenSamplesRef.current = {
          samples: new Float32Array(rb.subarray(0, rlen)),
          sampleRate: sampleRateRef.current,
        };
        setHasFrozenRecording(true);
      } else {
        frozenSamplesRef.current = null;
        setHasFrozenRecording(false);
      }
      recordBufRef.current = null;
      recordLenRef.current = 0;

      const endT = Date.now();
      if (liveIdRef.current) {
        const id = liveIdRef.current;
        setDetectedNotes((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (!last || last.id !== id) return prev;
          const dur = endT - last.startTime;
          if (dur < MIN_NOTE_MS) return prev.slice(0, -1);
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, endTime: endT };
          return copy;
        });
      }

      clearExtendTimer();
      resetBuffers();

      const sub = subscriptionRef.current;
      subscriptionRef.current = null;
      try {
        sub?.remove();
      } catch {
        /* ignore */
      }

      stoppingRef.current = false;

      if (ExpoPlayAudioStream) {
        void ExpoPlayAudioStream.stopMicrophone().catch(() => {
          /* ignore */
        });
      }

      runAutoTranscribe =
        autoTranscribeOnStop &&
        frozenSamplesRef.current != null &&
        frozenSamplesRef.current.samples.length > 0;
    } catch {
      stoppingRef.current = false;
    }

    if (runAutoTranscribe) {
      setStatus('Transcriere…');
      void transcribeFromRecording();
    }
  }, [autoTranscribeOnStop, clearExtendTimer, flushExtendNow, resetBuffers, transcribeFromRecording]);

  return {
    isListening,
    status,
    error,
    currentHz,
    currentLabel,
    detectedNotes,
    startListening,
    stopListening,
    hasFrozenRecording,
    transcribeProgress,
    transcribeError,
    transcribeFromRecording,
    autoTranscribeOnStop,
    setAutoTranscribeOnStop,
  };
}
