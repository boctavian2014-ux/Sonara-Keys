/** Shared treble staff layout for on-screen SVG and exported SVG. */

export const CLEF_W = 48;
export const NOTE_W = 36;
export const STAFF_LINE_YS = [20, 32, 44, 56, 68] as const;
export const MIDDLE_LINE_Y = 44;

const MIDI_TO_Y: Record<number, number> = {
  60: 82,
  61: 79,
  62: 74,
  63: 71,
  64: 68,
  65: 62,
  66: 59,
  67: 56,
  68: 53,
  69: 50,
  70: 47,
  71: 44,
  72: 38,
  73: 35,
  74: 32,
  75: 29,
  76: 26,
  77: 20,
  78: 17,
  79: 14,
  80: 11,
  81: 8,
};

export function midiToStaffY(midi: number): number {
  const entries = Object.entries(MIDI_TO_Y)
    .map(([k, y]) => [Number(k), y] as const)
    .sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return MIDDLE_LINE_Y;
  if (midi <= entries[0][0]) {
    const [m0, y0] = entries[0]!;
    const [m1, y1] = entries[1] ?? [m0 - 1, y0 + 3.5];
    const dm = m1 - m0;
    return dm === 0 ? y0 : y0 + ((midi - m0) / dm) * (y1 - y0);
  }
  if (midi >= entries[entries.length - 1]![0]) {
    const last = entries.length - 1;
    const [m1, y1] = entries[last]!;
    const [m0, y0] = entries[last - 1] ?? [m1 - 1, y1 + 3.5];
    const dm = m1 - m0;
    return dm === 0 ? y1 : y1 + ((midi - m1) / dm) * (y1 - y0);
  }
  for (let i = 0; i < entries.length - 1; i++) {
    const [m0, y0] = entries[i]!;
    const [m1, y1] = entries[i + 1]!;
    if (midi >= m0 && midi <= m1) {
      const dm = m1 - m0;
      return dm === 0 ? y0 : y0 + ((midi - m0) / dm) * (y1 - y0);
    }
  }
  return MIDDLE_LINE_Y;
}

export function accidentalSymbol(name: string): string | null {
  if (name.includes('#')) return '♯';
  if (name.toLowerCase().includes('b')) return '♭';
  return null;
}

export function ledgerYsForNote(cy: number): number[] {
  const top = STAFF_LINE_YS[0]!;
  const bottom = STAFF_LINE_YS[STAFF_LINE_YS.length - 1]!;
  const step = 12;
  const out: number[] = [];
  if (cy > bottom + 4) {
    for (let y = bottom; y < cy + 8; y += step) out.push(y);
  } else if (cy < top - 4) {
    for (let y = top; y > cy - 8; y -= step) out.push(y);
  }
  return out.slice(0, 5);
}

export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
