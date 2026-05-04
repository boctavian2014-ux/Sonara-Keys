import type { DetectedNote } from '../../types/notes';

import {
  CLEF_W,
  MIDDLE_LINE_Y,
  NOTE_W,
  STAFF_LINE_YS,
  accidentalSymbol,
  escapeXmlText,
  ledgerYsForNote,
  midiToStaffY,
} from './staffGeometry';

const STAFF_H = 112;
const LABEL_Y = 104;

/** Standalone SVG document (opens in browser / vector apps). */
export function buildStaffSvgDocument(sortedNotes: DetectedNote[]): string {
  const n = Math.max(sortedNotes.length, 1);
  const contentW = CLEF_W + 24 + n * NOTE_W + 32;
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${contentW}" height="${STAFF_H}" viewBox="0 0 ${contentW} ${STAFF_H}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#07111F"/>`);
  for (let i = 0; i < STAFF_LINE_YS.length; i++) {
    const y = STAFF_LINE_YS[i]!;
    parts.push(
      `<line x1="${CLEF_W + 6}" x2="${contentW - 12}" y1="${y}" y2="${y}" stroke="rgba(169,183,214,0.55)" stroke-width="1.2"/>`,
    );
  }

  sortedNotes.forEach((note, j) => {
    const cx = CLEF_W + 20 + j * NOTE_W;
    const cy = midiToStaffY(note.midi);
    const stemUp = cy > MIDDLE_LINE_Y;
    const stemLen = 30;
    const acc = accidentalSymbol(note.name);
    const label = escapeXmlText(`${note.name}${note.octave}`);

    for (const ly of ledgerYsForNote(cy)) {
      parts.push(
        `<line x1="${cx - 14}" x2="${cx + 14}" y1="${ly}" y2="${ly}" stroke="rgba(169,183,214,0.65)" stroke-width="1"/>`,
      );
    }

    parts.push(
      `<g transform="rotate(-15 ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="7" ry="5" fill="#FFFFFF" stroke="rgba(15,23,42,0.25)" stroke-width="0.8"/></g>`,
    );
    if (acc) {
      parts.push(
        `<text x="${cx - 14}" y="${cy + 4}" font-size="10" fill="rgba(255,255,255,0.82)">${escapeXmlText(acc)}</text>`,
      );
    }
    if (stemUp) {
      parts.push(
        `<line x1="${cx + 4}" y1="${cy - 5}" x2="${cx + 4}" y2="${cy - 5 - stemLen}" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>`,
      );
    } else {
      parts.push(
        `<line x1="${cx - 4}" y1="${cy + 5}" x2="${cx - 4}" y2="${cy + 5 + stemLen}" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>`,
      );
    }
    parts.push(
      `<text x="${cx}" y="${LABEL_Y}" font-size="10" fill="rgba(169,183,214,0.9)" text-anchor="middle">${label}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join('');
}
