import { frequencyToNoteName, yinDetectPitch } from '../../audio/pitchDetector';
import type { DetectedNote } from '../../types/notes';

const WINDOW_SIZE = 2048;
const HOP_SIZE = 2048;
const MIN_NOTE_SECONDS = 0.05;
const MAX_MERGE_GAP_SECONDS = 0.14;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Decimate mono PCM (box average) for cheaper YIN passes. */
function decimateAverage(mono: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return mono;
  const outLen = Math.floor(mono.length / factor);
  if (outLen < WINDOW_SIZE) return mono;
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const base = i * factor;
    let s = 0;
    for (let k = 0; k < factor; k++) s += mono[base + k] ?? 0;
    out[i] = s / factor;
  }
  return out;
}

type FrameNote = {
  midi: number;
  time: number;
};

function noteFromMidi(midi: number): { name: string; octave: number } {
  return {
    name: NOTE_NAMES[midi % 12]!,
    octave: Math.floor(midi / 12) - 1,
  };
}

function makeNote(midi: number, startTime: number, endTime: number, index: number): DetectedNote {
  const note = noteFromMidi(midi);
  return {
    id: `local-${Date.now()}-${index}-${startTime.toFixed(3)}`,
    name: note.name,
    octave: note.octave,
    startTime,
    endTime,
    midi,
  };
}

function framesToNotes(frames: FrameNote[], sampleRate: number): DetectedNote[] {
  if (frames.length === 0) return [];

  const frameEndPad = WINDOW_SIZE / sampleRate;
  const notes: DetectedNote[] = [];
  let curMidi = frames[0]!.midi;
  let start = frames[0]!.time;
  let last = frames[0]!.time;

  const push = () => {
    const end = last + frameEndPad;
    if (end - start >= MIN_NOTE_SECONDS) {
      notes.push(makeNote(curMidi, start, end, notes.length));
    }
  };

  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    const gap = f.time - last;
    if (f.midi === curMidi && gap <= MAX_MERGE_GAP_SECONDS) {
      last = f.time;
      continue;
    }
    push();
    curMidi = f.midi;
    start = f.time;
    last = f.time;
  }
  push();

  return notes;
}

/**
 * Fast local monophonic transcription. Decimates + large hop so long clips
 * do not freeze the JS thread for minutes on Android.
 */
export async function transcribeLocalPitch(
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (pct: number) => void,
  shouldCancel?: () => boolean,
): Promise<DetectedNote[]> {
  if (pcm.length < WINDOW_SIZE) return [];

  const decim = sampleRate >= 44100 ? 4 : sampleRate >= 22050 ? 2 : 1;
  const work = decimateAverage(pcm, decim);
  const sr = sampleRate / decim;

  const frames: FrameNote[] = [];
  const frameCount = Math.max(1, Math.floor((work.length - WINDOW_SIZE) / HOP_SIZE) + 1);
  let frame = 0;
  for (let start = 0; start + WINDOW_SIZE <= work.length; frame++, start += HOP_SIZE) {
    if (shouldCancel?.()) return [];
    const window = work.subarray(start, start + WINDOW_SIZE);
    const hz = yinDetectPitch(window, sr, 0.2);
    if (hz != null) {
      const { midi } = frequencyToNoteName(hz);
      if (midi > 0) {
        frames.push({ midi, time: start / sr });
      }
    }

    onProgress?.(frame / frameCount);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (shouldCancel?.()) return [];
  }

  onProgress?.(1);
  return framesToNotes(frames, sr);
}
