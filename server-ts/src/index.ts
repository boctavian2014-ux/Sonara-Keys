import path from 'node:path';

import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import cors from 'cors';
import express, { type Request } from 'express';
import multer from 'multer';

const WavDecoder = require('wav-decoder') as {
  decode: (input: ArrayBuffer) => Promise<{ sampleRate: number; channelData: Float32Array[] }>;
};

type TranscribeJsonBody = {
  wavBase64?: string;
  audioUrl?: string;
};

type DetectedNote = {
  id: string;
  name: string;
  octave: number;
  startTime: number;
  endTime: number;
  midi: number;
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const PORT = Number(process.env.RAILWAY_PORT || process.env.TRANSCRIBE_PORT || process.env.BP_PORT || 8787);
const upload = multer({ storage: multer.memoryStorage() });
const modelDir = path.resolve(__dirname, '../node_modules/@spotify/basic-pitch/model');
let basicPitchSingleton: BasicPitch | null = null;
function getBasicPitch(): BasicPitch {
  if (basicPitchSingleton != null) return basicPitchSingleton;
  basicPitchSingleton = new BasicPitch(`http://127.0.0.1:${PORT}/model/model.json`);
  return basicPitchSingleton;
}

function midiToNameOctave(midiRaw: number): { name: string; octave: number; midi: number } {
  const midi = Math.max(0, Math.min(127, Math.round(midiRaw)));
  return {
    name: NOTE_NAMES[midi % 12]!,
    octave: Math.floor(midi / 12) - 1,
    midi,
  };
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function readWavMono(wavBytes: Buffer): Promise<Float32Array> {
  const decoded = await WavDecoder.decode(toArrayBuffer(wavBytes));
  if (!Array.isArray(decoded.channelData) || decoded.channelData.length === 0) {
    throw new Error('WAV has no channels');
  }

  const channels = decoded.channelData;
  if (channels.length === 1) return channels[0]!;

  const length = channels[0]!.length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let s = 0;
    for (const c of channels) s += c[i] ?? 0;
    mono[i] = s / channels.length;
  }
  return mono;
}

async function getAudioFromRequest(req: Request): Promise<Buffer> {
  const rawBody = req.body;
  if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    return rawBody;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const file =
      files.find((f) => f.fieldname === 'audio') ??
      files.find((f) => f.fieldname === 'file') ??
      files[0];
    if (file?.buffer == null || file.buffer.length === 0) {
      throw new Error('Expected multipart form field "audio" or "file" with WAV bytes');
    }
    return file.buffer;
  }

  const body = (req.body ?? {}) as TranscribeJsonBody;
  if (typeof body.wavBase64 === 'string' && body.wavBase64.trim().length > 0) {
    return Buffer.from(body.wavBase64, 'base64');
  }

  if (typeof body.audioUrl === 'string' && body.audioUrl.trim().length > 0) {
    const url = body.audioUrl.trim();
    if (!url.toLowerCase().startsWith('https://')) {
      throw new Error('audioUrl must be an https:// URL');
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audioUrl fetch failed: ${res.status}`);
    const arr = new Uint8Array(await res.arrayBuffer());
    return Buffer.from(arr);
  }

  throw new Error('Expected JSON { wavBase64 } / { audioUrl } or multipart "audio"/"file"');
}

async function transcribeWav(wavBytes: Buffer): Promise<DetectedNote[]> {
  if (wavBytes.length < 44) throw new Error('WAV payload too small or empty');
  const mono = await readWavMono(wavBytes);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await getBasicPitch().evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    () => {
      // progress callback intentionally ignored
    },
  );

  const noteEvents = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
  const withBends = addPitchBendsToNoteEvents(contours, noteEvents);
  const timed = noteFramesToTime(withBends);

  return timed
    .map((n, i) => {
      const mapped = midiToNameOctave(n.pitchMidi);
      const startTime = Number(n.startTimeSeconds.toFixed(6));
      const endTime = Number((n.startTimeSeconds + n.durationSeconds).toFixed(6));
      return {
        id: `bp-ts-${i}-${startTime.toFixed(4)}`,
        name: mapped.name,
        octave: mapped.octave,
        startTime,
        endTime,
        midi: mapped.midi,
      } satisfies DetectedNote;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/model', express.static(modelDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, engine: 'basic-pitch-ts' });
});

const transcribeOctetStream = express.raw({ type: 'application/octet-stream', limit: '50mb' });

app.post(
  '/transcribe',
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('application/octet-stream')) {
      return transcribeOctetStream(req, res, next);
    }
    next();
  },
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('application/octet-stream')) {
      return next();
    }
    upload.any()(req, res, next);
  },
  async (req, res) => {
    const t0 = Date.now();
    let decodeMs = 0;
    let inferMs = 0;
    try {
      const tDecode0 = Date.now();
      const wavBytes = await getAudioFromRequest(req);
      decodeMs = Date.now() - tDecode0;
      const tInfer0 = Date.now();
      const notes = await transcribeWav(wavBytes);
      inferMs = Date.now() - tInfer0;
      const totalMs = Date.now() - t0;
      if (process.env.TRANSCRIBE_DEBUG === '1') {
        console.log(
          `[server-ts] /transcribe timing decodeMs=${decodeMs} inferMs=${inferMs} totalMs=${totalMs} notes=${notes.length}`,
        );
      }
      res.json({ ok: true, notes, engine: 'basic-pitch-ts' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: message });
    }
  },
);

async function prewarmBasicPitch(): Promise<void> {
  const t0 = Date.now();
  try {
    const bp = getBasicPitch();
    await bp.evaluateModel(
      new Float32Array(22_050),
      (_frames, _onsets, _contours) => {},
      () => {},
    );
    console.log(`[server-ts] Basic Pitch prewarm done in ${Date.now() - t0}ms`);
  } catch (e) {
    console.warn('[server-ts] Basic Pitch prewarm failed (first request may be slower):', e);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server-ts] listening on http://0.0.0.0:${PORT}`);
  void prewarmBasicPitch();
});
