import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { DetectedNote } from '../../types/notes';
import type { SavedMelodyPayload, SavedMelodySummary } from '../../types/savedMelody';
import { SAVED_MELODY_SCHEMA_VERSION } from '../../types/savedMelody';

const SUBDIR = 'saved-melodies';

function melodiesDir(): string | null {
  if (Platform.OS === 'web' || documentDirectory == null) return null;
  return `${documentDirectory}${SUBDIR}/`;
}

async function ensureDir(): Promise<string> {
  const dir = melodiesDir();
  if (dir == null) {
    throw new Error('Document storage is not available on this platform.');
  }
  const info = await getInfoAsync(dir);
  if (!info.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function isPayload(x: unknown): x is SavedMelodyPayload {
  if (x == null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.version === SAVED_MELODY_SCHEMA_VERSION &&
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.createdAtIso === 'string' &&
    Array.isArray(o.notes)
  );
}

export async function listSavedMelodies(): Promise<SavedMelodySummary[]> {
  const dir = melodiesDir();
  if (dir == null) return [];
  const info = await getInfoAsync(dir);
  if (!info.exists || !info.isDirectory) return [];

  const names = await readDirectoryAsync(dir);
  const summaries: SavedMelodySummary[] = [];

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readAsStringAsync(`${dir}${name}`, { encoding: 'utf8' });
      const parsed = JSON.parse(raw) as unknown;
      if (!isPayload(parsed)) continue;
      summaries.push({
        id: parsed.id,
        title: parsed.title,
        createdAtIso: parsed.createdAtIso,
        noteCount: parsed.notes.length,
      });
    } catch {
      /* skip corrupt file */
    }
  }

  summaries.sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
  return summaries;
}

export async function loadSavedMelody(id: string): Promise<SavedMelodyPayload | null> {
  const dir = melodiesDir();
  if (dir == null) return null;
  const path = `${dir}${id}.json`;
  const info = await getInfoAsync(path);
  if (!info.exists || info.isDirectory) return null;
  try {
    const raw = await readAsStringAsync(path, { encoding: 'utf8' });
    const parsed = JSON.parse(raw) as unknown;
    if (!isPayload(parsed) || parsed.id !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMelodyToLibrary(title: string, notes: DetectedNote[]): Promise<SavedMelodyPayload> {
  const dir = await ensureDir();
  const id = `m_${Date.now()}`;
  const payload: SavedMelodyPayload = {
    version: SAVED_MELODY_SCHEMA_VERSION,
    id,
    title: title.trim() || 'Melodie fără titlu',
    createdAtIso: new Date().toISOString(),
    notes,
  };
  const path = `${dir}${id}.json`;
  await writeAsStringAsync(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8' });
  return payload;
}

export async function deleteSavedMelody(id: string): Promise<void> {
  const dir = melodiesDir();
  if (dir == null) return;
  const path = `${dir}${id}.json`;
  const info = await getInfoAsync(path);
  if (info.exists && !info.isDirectory) {
    await deleteAsync(path, { idempotent: true });
  }
}
