import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import type { DetectedNote } from '../types/notes';

type StaffViewProps = {
  notes: DetectedNote[];
  /** Pixel width of the SVG canvas (used to compute how many notes fit per row). */
  width: number;
  /** Max notes kept end of list (older dropped). */
  maxNotes?: number;
  /** When set, this note id is outlined (e.g. playback cursor). */
  highlightNoteId?: string | null;
};

const LINE_GAP = 11;
const LINE_COUNT = 5;
/** E4 pe linia de jos a cheii Sol (treble). */
const BOTTOM_LINE_MIDI = 64;
const LEFT_MARGIN = 36;
const NOTE_SPACING = 44;
const STAFF_TOP = 28;
const ROW_CONTENT_HEIGHT = 140;
/** Spațiu vertical între două portative. */
const ROW_GAP = 20;
const ROW_STRIDE = STAFF_TOP + ROW_CONTENT_HEIGHT + ROW_GAP;

function midiToY(midi: number, staffTop: number): number {
  const stepsFromE4 = midi - BOTTOM_LINE_MIDI;
  const bottomLineY = staffTop + (LINE_COUNT - 1) * LINE_GAP;
  return bottomLineY - stepsFromE4 * (LINE_GAP / 2);
}

function rowStaffWidth(noteCount: number): number {
  return LEFT_MARGIN + Math.max(noteCount, 1) * NOTE_SPACING + 24;
}

export function StaffView({ notes, width: pixelWidth, maxNotes = 48, highlightNoteId = null }: StaffViewProps) {
  const slice = useMemo(() => notes.slice(-maxNotes), [notes, maxNotes]);

  const notesPerRow = Math.max(1, Math.floor((pixelWidth - LEFT_MARGIN - 24) / NOTE_SPACING));

  const rows = useMemo(() => {
    if (slice.length === 0) return [[]] as DetectedNote[][];
    const out: DetectedNote[][] = [];
    for (let i = 0; i < slice.length; i += notesPerRow) {
      out.push(slice.slice(i, i + notesPerRow));
    }
    return out;
  }, [slice, notesPerRow]);

  const canvasW = useMemo(() => {
    return Math.max(...rows.map((r) => rowStaffWidth(r.length)), pixelWidth);
  }, [rows, pixelWidth]);

  const totalHeight = rows.length * ROW_STRIDE - ROW_GAP + 8;

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <Svg width={canvasW} height={totalHeight} viewBox={`0 0 ${canvasW} ${totalHeight}`}>
        {rows.map((rowNotes, ri) => {
          const dy = ri * ROW_STRIDE;
          const staffTop = STAFF_TOP + dy;
          const rowW = rowStaffWidth(rowNotes.length);
          const lineXs = { x1: 16, x2: rowW - 12 };
          const labelRowY = dy + ROW_CONTENT_HEIGHT - 10;

          return (
            <G key={`row-${ri}`}>
              {ri === 0 ? (
                <SvgText x={8} y={22} fontSize={13} fill="#444">
                  Cheie Sol
                </SvgText>
              ) : null}

              {Array.from({ length: LINE_COUNT }, (_, i) => (
                <Line
                  key={`ln-${ri}-${i}`}
                  x1={lineXs.x1}
                  x2={lineXs.x2}
                  y1={staffTop + i * LINE_GAP}
                  y2={staffTop + i * LINE_GAP}
                  stroke="#222"
                  strokeWidth={1.2}
                />
              ))}

              {rowNotes.map((n, j) => {
                const cx = LEFT_MARGIN + j * NOTE_SPACING;
                const cy = midiToY(n.midi, staffTop);
                const label = `${n.name}${n.octave}`;
                return (
                  <G key={n.id}>
                    {cy > staffTop + (LINE_COUNT - 1) * LINE_GAP + 2 && (
                      <Line
                        x1={cx - 14}
                        x2={cx + 14}
                        y1={staffTop + (LINE_COUNT - 1) * LINE_GAP}
                        y2={staffTop + (LINE_COUNT - 1) * LINE_GAP}
                        stroke="#222"
                        strokeWidth={1}
                      />
                    )}
                    {cy < staffTop - 2 && (
                      <Line
                        x1={cx - 14}
                        x2={cx + 14}
                        y1={staffTop}
                        y2={staffTop}
                        stroke="#222"
                        strokeWidth={1}
                      />
                    )}
                    <Circle cx={cx} cy={cy} r={9} fill="#111" />
                    {highlightNoteId != null && n.id === highlightNoteId ? (
                      <Circle cx={cx} cy={cy} r={14} fill="none" stroke="#3AA0FF" strokeWidth={2} opacity={0.95} />
                    ) : null}
                    <SvgText x={cx} y={labelRowY} fontSize={11} fill="#333" textAnchor="middle">
                      {label}
                    </SvgText>
                  </G>
                );
              })}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
