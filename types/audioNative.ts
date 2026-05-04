/**
 * Tipuri minime pentru chunk-urile de microfon (aliniate la @edkimmel/expo-audio-stream),
 * fără a importa pachetul la nivel de fișier — evită rezolvări Metro inutile.
 */
export type MicAudioChunk = {
  data: string | Float32Array;
  position: number;
};

/** API static folosit în hook (subset). */
export type ExpoPlayAudioStreamNative = {
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>;
  startMicrophone(cfg: {
    sampleRate: number;
    channels: number;
    encoding: string;
    interval: number;
    onAudioStream: (event: MicAudioChunk) => Promise<void>;
  }): Promise<{
    recordingResult: { sampleRate?: number };
    subscription?: { remove: () => void };
  }>;
  stopMicrophone(): Promise<unknown>;
};
