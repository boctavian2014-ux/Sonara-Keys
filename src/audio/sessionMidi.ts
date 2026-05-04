import type { DetectedNote } from '../../types/notes';
import { sortNotesByTime } from './midiUtils';

const PPQ = 480;
const DEFAULT_BPM = 120;
const MICROSECONDS_PER_QUARTER = Math.round(60_000_000 / DEFAULT_BPM);

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function u16be(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, false);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** MIDI file variable-length quantity. */
function toVarLen(value: number): number[] {
  const buffer: number[] = [];
  let v = Math.max(0, Math.floor(value)) >>> 0;
  buffer.push(v & 0x7f);
  v >>>= 7;
  while (v > 0) {
    buffer.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return buffer.reverse();
}

function ticksForSeconds(sec: number): number {
  return Math.max(0, Math.round((sec * PPQ * DEFAULT_BPM) / 60));
}

function clampMidi(n: number): number {
  return Math.max(0, Math.min(127, Math.round(n)));
}

/**
 * Standard MIDI File (format 0), single track, channel 1 (0x90 / 0x80).
 * Times map from `DetectedNote` seconds using fixed 120 BPM and PPQ 480.
 */
export function buildMidiFileBytes(notes: DetectedNote[]): Uint8Array {
  const sorted = sortNotesByTime(notes);
  type Timed = { tick: number; data: number[] };
  const events: Timed[] = [];

  for (const n of sorted) {
    const pitch = clampMidi(n.midi);
    const t0 = ticksForSeconds(n.startTime);
    const t1 = Math.max(t0 + 1, ticksForSeconds(n.endTime));
    events.push({ tick: t0, data: [0x90, pitch, 0x64] });
    events.push({ tick: t1, data: [0x80, pitch, 0x40] });
  }

  events.sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : a.data[0]! - b.data[0]!));

  const track: number[] = [];
  track.push(0x00, 0xff, 0x51, 0x03);
  track.push(
    (MICROSECONDS_PER_QUARTER >> 16) & 0xff,
    (MICROSECONDS_PER_QUARTER >> 8) & 0xff,
    MICROSECONDS_PER_QUARTER & 0xff,
  );
  track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  let prevTick = 0;
  for (const ev of events) {
    const delta = ev.tick - prevTick;
    prevTick = ev.tick;
    track.push(...toVarLen(delta), ...ev.data);
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const trackBody = new Uint8Array(track);
  const mthd = concat(
    new TextEncoder().encode('MThd'),
    u32be(6),
    u16be(0),
    u16be(1),
    u16be(PPQ),
  );
  const mtrk = concat(new TextEncoder().encode('MTrk'), u32be(trackBody.length), trackBody);
  return concat(mthd, mtrk);
}
