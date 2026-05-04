import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';

import type { DetectedNote } from '../../types/notes';
import { sortNotesByTime } from './midiUtils';
import { buildMidiFileBytes } from './sessionMidi';
import { buildStaffSvgDocument } from './sessionStaffSvg';

export type SessionExportPayload = {
  version: 1;
  exportedAtIso: string;
  notes: DetectedNote[];
};

function buildJsonExport(notes: DetectedNote[]): string {
  const payload: SessionExportPayload = {
    version: 1,
    exportedAtIso: new Date().toISOString(),
    notes: sortNotesByTime(notes),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const page = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += page) {
    const sub = bytes.subarray(i, i + page);
    let s = '';
    for (let j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j]!);
    chunks.push(s);
  }
  const bin = chunks.join('');
  if (typeof btoa === 'function') return btoa(bin);
  throw new Error('btoa is not available in this runtime');
}

async function writeTempFile(
  name: string,
  body: string,
  encoding: typeof EncodingType.UTF8 | typeof EncodingType.Base64 = EncodingType.UTF8,
): Promise<string> {
  if (cacheDirectory == null) {
    throw new Error('Cache directory unavailable');
  }
  const path = `${cacheDirectory}${name}`;
  await writeAsStringAsync(path, body, { encoding });
  return path;
}

export async function shareSessionStaffSvg(notes: DetectedNote[]): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Export', 'Salvarea fișierelor nu este disponibilă pe web.');
    return;
  }
  const sorted = sortNotesByTime(notes);
  if (sorted.length === 0) {
    Alert.alert('Portativ', 'Nu există note de salvat. Ascultă mai întâi câteva secunde.');
    return;
  }
  try {
    const svg = buildStaffSvgDocument(sorted);
    const path = await writeTempFile(`sonara-keys-portativ-${Date.now()}.svg`, svg);
    const can = await Sharing.isAvailableAsync();
    if (!can) {
      Alert.alert('Export', 'Partajarea nu este disponibilă pe acest dispozitiv.');
      return;
    }
    await Sharing.shareAsync(
      path,
      Platform.OS === 'android'
        ? { dialogTitle: 'Salvează portativul (SVG)' }
        : {
            mimeType: 'image/svg+xml',
            UTI: 'public.svg-image',
            dialogTitle: 'Salvează portativul (SVG)',
          },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Alert.alert('Export', msg || 'Nu s-a putut salva SVG.');
  }
}

export async function shareSessionMidi(notes: DetectedNote[]): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Export', 'Salvarea fișierelor nu este disponibilă pe web.');
    return;
  }
  const sorted = sortNotesByTime(notes);
  if (sorted.length === 0) {
    Alert.alert('Export MIDI', 'Nu există note de exportat.');
    return;
  }
  try {
    const midi = buildMidiFileBytes(sorted);
    const b64 = uint8ToBase64(midi);
    const path = await writeTempFile(`sonara-keys-${Date.now()}.mid`, b64, EncodingType.Base64);
    const can = await Sharing.isAvailableAsync();
    if (!can) {
      Alert.alert('Export', 'Partajarea nu este disponibilă pe acest dispozitiv.');
      return;
    }
    await Sharing.shareAsync(path, {
      mimeType: 'audio/midi',
      dialogTitle: 'Export MIDI',
      ...(Platform.OS === 'ios' ? { UTI: 'public.midi-audio' as const } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Alert.alert('Export MIDI', msg || 'Nu s-a putut exporta fișierul MIDI.');
  }
}

export async function shareSessionNotesJson(notes: DetectedNote[]): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Export', 'Salvarea fișierelor nu este disponibilă pe web.');
    return;
  }
  const sorted = sortNotesByTime(notes);
  if (sorted.length === 0) {
    Alert.alert('Export note', 'Nu există note de exportat.');
    return;
  }
  try {
    const json = buildJsonExport(sorted);
    const path = await writeTempFile(`sonara-keys-sesiune-${Date.now()}.json`, json);
    const can = await Sharing.isAvailableAsync();
    if (!can) {
      Alert.alert('Export', 'Partajarea nu este disponibilă pe acest dispozitiv.');
      return;
    }
    await Sharing.shareAsync(path, {
      mimeType: 'application/json',
      dialogTitle: 'Export note (JSON)',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Alert.alert('Export', msg || 'Nu s-a putut exporta JSON.');
  }
}
