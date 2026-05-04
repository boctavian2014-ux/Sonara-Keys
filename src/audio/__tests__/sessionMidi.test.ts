import type { DetectedNote } from '../../../types/notes';
import { buildMidiFileBytes } from '../sessionMidi';

describe('buildMidiFileBytes', () => {
  it('writes a valid SMF header and track chunk', () => {
    const notes: DetectedNote[] = [
      {
        id: '1',
        name: 'C',
        octave: 4,
        startTime: 0,
        endTime: 0.5,
        midi: 60,
      },
    ];
    const bytes = buildMidiFileBytes(notes);
    const head = String.fromCharCode(...bytes.subarray(0, 4));
    expect(head).toBe('MThd');
    // MThd(4) + BE32(6)(4) + format/tracks/division(6) = 14 bytes, then MTrk
    const mtrkAt = 14;
    expect(String.fromCharCode(...bytes.subarray(mtrkAt, mtrkAt + 4))).toBe('MTrk');
  });
});
