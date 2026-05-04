import { midiToFrequency } from './midiUtils';

/** Subset of expo-audio player we use (avoid static import so app boots without native ExpoAudio). */
type ExpoAudioPlayer = {
  isLoaded: boolean;
  volume: number;
  play: () => void;
  pause: () => void;
  remove: () => void;
};

type ExpoAudioModule = {
  createAudioPlayer: (
    source: { uri: string },
    options?: { updateInterval?: number },
  ) => ExpoAudioPlayer;
  setAudioModeAsync: (mode: {
    playsInSilentMode?: boolean;
    shouldPlayInBackground?: boolean;
    allowsRecording?: boolean;
    shouldRouteThroughEarpiece?: boolean;
    interruptionMode?: string;
  }) => Promise<void>;
};

const DEFAULT_RATE = 44100;
const DEFAULT_AMP = 0.4;
const DEFAULT_ATTACK = 10;
const DEFAULT_RELEASE = 60;

let audioModeReady = false;
const activePlayers: ExpoAudioPlayer[] = [];

let expoAudioLoadPromise: Promise<ExpoAudioModule | null> | null = null;

function loadExpoAudio(): Promise<ExpoAudioModule | null> {
  if (!expoAudioLoadPromise) {
    expoAudioLoadPromise = import('expo-audio')
      .then((m) => m as ExpoAudioModule)
      .catch((e) => {
        console.warn('[ToneSynth] expo-audio unavailable (rebuild with npx expo run:android)', e);
        return null;
      });
  }
  return expoAudioLoadPromise;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }
}

/** 16-bit PCM mono WAV bytes (RIFF + fmt + data). */
function buildWavPcm16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const q = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(off, Math.round(q), true);
    off += 2;
  }
  return buffer;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function ensurePlaybackAudioMode(expo: ExpoAudioModule): Promise<void> {
  if (audioModeReady) return;
  await expo.setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    allowsRecording: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: 'mixWithOthers',
  });
  audioModeReady = true;
}

function generateSineWaveWAV(
  frequencyHz: number,
  durationMs: number,
  sampleRate: number = DEFAULT_RATE,
  amplitude: number = DEFAULT_AMP,
  attackMs: number = DEFAULT_ATTACK,
  releaseMs: number = DEFAULT_RELEASE,
): string {
  const n = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));
  const attackSamples = Math.min(n - 1, Math.max(0, Math.floor((attackMs / 1000) * sampleRate)));
  const releaseSamples = Math.min(n - attackSamples - 1, Math.max(0, Math.floor((releaseMs / 1000) * sampleRate)));
  const sustainEnd = n - releaseSamples;
  const out = new Float32Array(n);
  const twoPiF = 2 * Math.PI * frequencyHz;
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attackSamples && attackSamples > 0) {
      env = i / attackSamples;
    } else if (i >= sustainEnd && releaseSamples > 0) {
      env = (n - 1 - i) / releaseSamples;
    }
    const t = i / sampleRate;
    out[i] = amplitude * env * Math.sin(twoPiF * t);
  }
  const buf = buildWavPcm16Mono(out, sampleRate);
  return uint8ToBase64(new Uint8Array(buf));
}

async function waitUntilPlayerLoaded(player: ExpoAudioPlayer, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!player.isLoaded && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 25));
  }
}

export class ToneSynth {
  /**
   * Warms up the audio session (critical on iOS: silent switch + ducking).
   * Safe to call multiple times; PracticeScreen should call on mount.
   */
  static async preload(): Promise<void> {
    const expo = await loadExpoAudio();
    if (!expo) return;
    await ensurePlaybackAudioMode(expo);
  }

  /**
   * Generates mono 16-bit PCM WAV as raw base64 (no `data:` prefix).
   * Linear attack/release on full duration to reduce clicks.
   */
  static generateSineWaveWAV(
    frequencyHz: number,
    durationMs: number,
    sampleRate: number = DEFAULT_RATE,
    amplitude: number = DEFAULT_AMP,
    attackMs: number = DEFAULT_ATTACK,
    releaseMs: number = DEFAULT_RELEASE,
  ): string {
    return generateSineWaveWAV(frequencyHz, durationMs, sampleRate, amplitude, attackMs, releaseMs);
  }

  static async playNote(midi: number, durationMs: number): Promise<void> {
    const expo = await loadExpoAudio();
    if (!expo) return;
    await ensurePlaybackAudioMode(expo);
    const hz = midiToFrequency(midi);
    const b64 = generateSineWaveWAV(hz, durationMs);
    const uri = `data:audio/wav;base64,${b64}`;
    const player = expo.createAudioPlayer({ uri }, { updateInterval: 100 });
    activePlayers.push(player);
    const unloadAfter = Math.ceil(durationMs) + 200;
    try {
      await waitUntilPlayerLoaded(player, 4000);
      if (player.isLoaded) {
        player.volume = 1;
        player.play();
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, unloadAfter);
      });
    } finally {
      try {
        player.pause();
      } catch {
        /* ignore */
      }
      try {
        player.remove();
      } catch {
        /* ignore */
      }
      const ix = activePlayers.indexOf(player);
      if (ix >= 0) activePlayers.splice(ix, 1);
    }
  }

  static async stopAll(): Promise<void> {
    const copy = [...activePlayers];
    activePlayers.length = 0;
    for (const p of copy) {
      try {
        p.pause();
      } catch {
        /* ignore */
      }
      try {
        p.remove();
      } catch {
        /* ignore */
      }
    }
  }
}
