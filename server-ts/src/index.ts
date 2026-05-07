import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';

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

type ScoreAnalysis = {
  tempoBpm: number | null;
  timeSignature: { beatsPerBar: number; beatUnit: 4 | 8 };
  keySignature: { tonic: string; mode: 'major' | 'minor'; accidentals: { kind: 'sharp' | 'flat'; count: number } };
  measures: { index: number; startBeats: number; endBeats: number }[];
  notes: (DetectedNote & {
    hand: 'RH' | 'LH';
    qOnsetBeats: number;
    qDurBeats: number;
    value:
      | 'whole'
      | 'half'
      | 'half_dotted'
      | 'quarter'
      | 'quarter_dotted'
      | 'eighth'
      | 'eighth_dotted'
      | 'sixteenth'
      | 'thirty_second';
    measureIndex: number;
    beatInMeasure: number;
    onsetGroupId: string;
  })[];
  chords: unknown[];
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const PORT = Number(process.env.PORT || process.env.TRANSCRIBE_PORT || process.env.BP_PORT || 8787);
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

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'server-ts',
    routes: ['/health', 'POST /transcribe', 'GET /render-score-svg (hint)', 'POST /render-score-svg'],
  });
});

app.get('/render-score-svg', (_req, res) => {
  res.json({
    ok: true,
    hint: 'POST JSON { "analysis": ScoreAnalysis } with Content-Type: application/json to receive { ok, svg }.',
  });
});

type RenderScoreBody = { analysis?: ScoreAnalysis };

const svgCache = new Map<string, string>();
const svgCacheOrder: string[] = [];
const SVG_CACHE_MAX = 32;

function cacheGet(key: string): string | null {
  const v = svgCache.get(key);
  if (!v) return null;
  const i = svgCacheOrder.indexOf(key);
  if (i >= 0) svgCacheOrder.splice(i, 1);
  svgCacheOrder.push(key);
  return v;
}

function cachePut(key: string, svg: string) {
  svgCache.set(key, svg);
  const i = svgCacheOrder.indexOf(key);
  if (i >= 0) svgCacheOrder.splice(i, 1);
  svgCacheOrder.push(key);
  while (svgCacheOrder.length > SVG_CACHE_MAX) {
    const old = svgCacheOrder.shift();
    if (old) svgCache.delete(old);
  }
}

function lilyPitchFromMidi(midiRaw: number): string {
  const midi = Math.max(0, Math.min(127, Math.round(midiRaw)));
  // Prefer sharps to match current app note names
  const pcs = ['c', 'cis', 'd', 'dis', 'e', 'f', 'fis', 'g', 'gis', 'a', 'ais', 'b'] as const;
  const pc = pcs[midi % 12]!;
  const octave = Math.floor(midi / 12) - 1; // scientific octave number
  // LilyPond: middle C (C4) is c'
  const marks = octave - 3; // octave 3 => c, 4 => c', 5 => c''
  const suffix = marks > 0 ? "'".repeat(marks) : ','.repeat(-marks);
  return `${pc}${suffix}`;
}

function valueToLilyDuration(value: ScoreAnalysis['notes'][number]['value']): string {
  if (value === 'whole') return '1';
  if (value === 'half') return '2';
  if (value === 'half_dotted') return '2.';
  if (value === 'quarter') return '4';
  if (value === 'quarter_dotted') return '4.';
  if (value === 'eighth') return '8';
  if (value === 'eighth_dotted') return '8.';
  if (value === 'sixteenth') return '16';
  return '32';
}

function beatsToLilyRest(beats: number): string[] {
  // Emit rests that sum to `beats` (in quarter-note beats), using common values.
  let rem = Math.max(0, beats);
  const out: string[] = [];
  const push = (dur: string, beatCost: number) => {
    if (rem + 1e-6 >= beatCost) {
      out.push(`r${dur}`);
      rem -= beatCost;
      return true;
    }
    return false;
  };

  // Prefer bigger units first; include dotted where useful.
  while (rem > 1e-6) {
    if (push('1', 4)) continue;
    if (push('2.', 3)) continue;
    if (push('2', 2)) continue;
    if (push('4.', 1.5)) continue;
    if (push('4', 1)) continue;
    if (push('8.', 0.75)) continue;
    if (push('8', 0.5)) continue;
    if (push('16', 0.25)) continue;
    // last resort
    out.push('r32');
    rem -= 0.125;
  }
  return out;
}

function lilypondFromAnalysis(analysis: ScoreAnalysis): string {
  const beatsPerBar = Number.isFinite(analysis.timeSignature?.beatsPerBar) ? analysis.timeSignature.beatsPerBar : 4;
  const beatUnit = analysis.timeSignature?.beatUnit === 8 ? 8 : 4;
  const barLenBeats = beatsPerBar * (beatUnit === 8 ? 0.5 : 1);

  const measureCount =
    Array.isArray(analysis.measures) && analysis.measures.length > 0
      ? analysis.measures.length
      : Math.max(1, ...analysis.notes.map((n) => (Number.isFinite(n.measureIndex) ? n.measureIndex + 1 : 1)));

  const byMeasureHand: Array<{ RH: ScoreAnalysis['notes']; LH: ScoreAnalysis['notes'] }> = Array.from(
    { length: measureCount },
    () => ({ RH: [], LH: [] }),
  );
  for (const n of analysis.notes) {
    const mi = Math.max(0, Math.min(measureCount - 1, Math.floor(n.measureIndex)));
    byMeasureHand[mi]![n.hand].push(n);
  }

  const renderHand = (hand: 'RH' | 'LH'): string => {
    const measuresOut: string[] = [];
    for (let mi = 0; mi < measureCount; mi += 1) {
      const notes = byMeasureHand[mi]![hand]
        .slice()
        .sort((a, b) => a.beatInMeasure - b.beatInMeasure || a.midi - b.midi);

      // group by onsetGroupId within measure (chords)
      const groups = new Map<string, ScoreAnalysis['notes']>();
      for (const n of notes) {
        const k = String(n.onsetGroupId || n.beatInMeasure.toFixed(3));
        const arr = groups.get(k);
        if (arr) arr.push(n);
        else groups.set(k, [n]);
      }
      const onsets = Array.from(groups.values()).sort((a, b) => (a[0]!.beatInMeasure ?? 0) - (b[0]!.beatInMeasure ?? 0));

      let curBeat = 0;
      const tokens: string[] = [];
      for (const chordNotes of onsets) {
        const onset = chordNotes[0]!.beatInMeasure ?? 0;
        const gap = onset - curBeat;
        if (gap > 1e-6) {
          tokens.push(...beatsToLilyRest(gap));
          curBeat += gap;
        }

        const sorted = chordNotes.slice().sort((a, b) => a.midi - b.midi);
        const dur = valueToLilyDuration(sorted[0]!.value);
        const pitches = sorted.map((n) => lilyPitchFromMidi(n.midi));
        const noteToken = pitches.length > 1 ? `<${pitches.join(' ')}>${dur}` : `${pitches[0]!}${dur}`;
        tokens.push(noteToken);

        // advance by the longest duration in the onset group
        const maxBeats = Math.max(...sorted.map((n) => n.qDurBeats || 0.125));
        curBeat += Math.max(0.125, maxBeats);
      }

      const tail = barLenBeats - curBeat;
      if (tail > 1e-6) tokens.push(...beatsToLilyRest(tail));

      // barline per measure; LilyPond will manage layout
      measuresOut.push(`${tokens.join(' ')} |`);
    }
    return measuresOut.join('\n');
  };

  const tempo = analysis.tempoBpm ?? 120;

  return `
\\version "2.24.0"

\\paper {
  indent = 0\\mm
  ragged-last = ##f
}

\\layout { }

rh = {
  \\autoBeamOff
  \\clef treble
  \\time ${beatsPerBar}/${beatUnit}
  \\tempo 4 = ${Math.round(tempo)}
  ${renderHand('RH')}
}

lh = {
  \\autoBeamOff
  \\clef bass
  \\time ${beatsPerBar}/${beatUnit}
  ${renderHand('LH')}
}

\\score {
  \\new PianoStaff <<
    \\new Staff = "RH" \\rh
    \\new Staff = "LH" \\lh
  >>
}
`.trim();
}

async function renderSvgViaLilyPond(analysis: ScoreAnalysis): Promise<string> {
  const bodyKey = crypto.createHash('sha256').update(JSON.stringify({ analysis })).digest('hex');
  const cached = cacheGet(bodyKey);
  if (cached) return cached;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonara-ly-'));
  const inPath = path.join(tmpDir, 'score.ly');
  const outPrefix = path.join(tmpDir, 'out');
  await fs.writeFile(inPath, lilypondFromAnalysis(analysis), 'utf8');

  const args = ['-dbackend=svg', '-o', outPrefix, inPath];
  const proc = spawn('lilypond', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += String(d);
  });

  const exitCode: number = await new Promise((resolve) => proc.on('close', resolve));
  if (exitCode !== 0) {
    throw new Error(`LilyPond failed (${exitCode}). ${stderr.slice(0, 1200)}`);
  }

  const candidates = [path.join(tmpDir, 'out.svg'), path.join(tmpDir, 'out-1.svg')];
  let svgPath: string | null = null;
  for (const p of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.stat(p);
      svgPath = p;
      break;
    } catch {
      // continue
    }
  }
  if (!svgPath) {
    throw new Error('LilyPond did not produce SVG output.');
  }
  const svg = await fs.readFile(svgPath, 'utf8');
  cachePut(bodyKey, svg);
  return svg;
}

app.post('/render-score-svg', async (req, res) => {
  try {
    const body = (req.body ?? {}) as RenderScoreBody;
    if (!body.analysis || !Array.isArray(body.analysis.notes)) {
      return res.status(400).json({ ok: false, error: 'Expected JSON body { analysis: ScoreAnalysis }' });
    }
    const svg = await renderSvgViaLilyPond(body.analysis);
    return res.json({ ok: true, svg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
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
