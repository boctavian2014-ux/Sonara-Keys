/**
 * Singleton Basic Pitch runner — tf.ready() before load, one model instance, polyphonic params tuned for ambient audio.
 */
import type { NoteEventTime } from '@spotify/basic-pitch';
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';

import { resampleTo22050 } from '../../audio/basicPitchResample';
import type { DetectedNote } from '../../types/notes';

import { ensureTfjsPlatformForReactNative } from './tfjsRnPlatform';

/** Prefer jsdelivr (often more reliable on mobile networks than unpkg). */
export const BASIC_PITCH_MODEL_URL_PRIMARY =
  'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';

export const BASIC_PITCH_MODEL_URL_FALLBACK =
  'https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json';

let modelInstance: BasicPitch | null = null;
let loadPromise: Promise<void> | null = null;

async function constructModelFromUrl(url: string): Promise<BasicPitch> {
  return new BasicPitch(url);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function mapNoteEventTimeToDetected(
  n: NoteEventTime,
  idBase: string,
  index: number,
  sessionOffsetSec: number,
): DetectedNote {
  const midi = Math.round(Math.min(127, Math.max(0, n.pitchMidi)));
  return {
    id: `${idBase}-${index}-${n.startTimeSeconds.toFixed(4)}`,
    name: NOTE_NAMES[midi % 12]!,
    octave: Math.floor(midi / 12) - 1,
    startTime: n.startTimeSeconds + sessionOffsetSec,
    endTime: n.startTimeSeconds + n.durationSeconds + sessionOffsetSec,
    midi,
  };
}

/** `onLoadProgress` receives 0..1 while weights / TF are loading (can take tens of seconds on first run). */
export async function loadModel(onLoadProgress?: (n: number) => void): Promise<void> {
  if (modelInstance != null) {
    onLoadProgress?.(1);
    return;
  }
  if (loadPromise != null) {
    try {
      await loadPromise;
    } catch {
      loadPromise = null;
    }
    if (modelInstance != null) {
      onLoadProgress?.(1);
      return;
    }
  }
  loadPromise = (async () => {
    onLoadProgress?.(0.05);
    ensureTfjsPlatformForReactNative();
    onLoadProgress?.(0.12);
    await tf.ready();
    onLoadProgress?.(0.22);
    const cpuOk = await tf.setBackend('cpu');
    if (!cpuOk) {
      throw new Error('TensorFlow.js could not use the CPU backend on this device.');
    }
    await tf.ready();
    onLoadProgress?.(0.32);
    try {
      modelInstance = await constructModelFromUrl(BASIC_PITCH_MODEL_URL_PRIMARY);
    } catch {
      modelInstance = await constructModelFromUrl(BASIC_PITCH_MODEL_URL_FALLBACK);
    }
    onLoadProgress?.(1);
  })();
  await loadPromise;
}

export function isModelLoaded(): boolean {
  return modelInstance != null;
}

async function evaluateToDetectedNotes(
  monoFloat32: Float32Array,
  sampleRate: number,
  sessionOffsetSec: number,
  onProgress?: (pct: number) => void,
): Promise<DetectedNote[]> {
  const LOAD_SHARE = 0.38;
  await loadModel((loadPct) => {
    onProgress?.(loadPct * LOAD_SHARE);
  });
  if (modelInstance == null) return [];

  const resampled = resampleTo22050(monoFloat32, sampleRate);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await modelInstance.evaluateModel(
    resampled,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (modelPct) => {
      onProgress?.(LOAD_SHARE + modelPct * (1 - LOAD_SHARE));
    },
  );

  const poly = outputToNotesPoly(
    frames,
    onsets,
    0.22,
    0.16,
    3,
    true,
    2093,
    65,
    false,
    11,
  );
  const withBends = addPitchBendsToNoteEvents(contours, poly);
  const timed = noteFramesToTime(withBends);
  const batch = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return timed.map((e, i) => mapNoteEventTimeToDetected(e, batch, i, sessionOffsetSec));
}

/**
 * Runs Basic Pitch on preprocessed mono float32 PCM. Times are in seconds; `sessionStartTime` shifts into global session timeline.
 */
export async function runBasicPitch(
  audio: Float32Array,
  sampleRate: number,
  sessionStartTime: number,
  onProgress?: (pct: number) => void,
): Promise<DetectedNote[]> {
  if (audio.length === 0) return [];
  const notes = await evaluateToDetectedNotes(audio, sampleRate, sessionStartTime, onProgress);
  notes.sort((a, b) => a.startTime - b.startTime);
  return notes;
}

/** Legacy entry: raw PCM at `sampleRate`, no preprocess (caller may normalize/window). */
export async function runBasicPitchOnPcm(
  mono: Float32Array,
  sampleRate: number,
  onProgress?: (pct: number) => void,
): Promise<DetectedNote[]> {
  return runBasicPitch(mono, sampleRate, 0, onProgress);
}
