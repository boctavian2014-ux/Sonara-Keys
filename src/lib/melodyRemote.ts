import type { SavedMelodyPayload, SavedMelodySummary } from '../../types/savedMelody';
import { SAVED_MELODY_SCHEMA_VERSION } from '../../types/savedMelody';
import { supabase } from './supabase';

type KindeSubjectProvider = {
  getDecodedToken: () => Promise<unknown>;
  getUserProfile: () => Promise<unknown>;
};

function rowToPayload(o: Record<string, unknown>): SavedMelodyPayload | null {
  const version = Number(o.schema_version);
  if (version !== SAVED_MELODY_SCHEMA_VERSION) return null;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.notes)) {
    return null;
  }
  const catRaw = o.created_at_iso;
  const createdAtIso =
    typeof catRaw === 'string' ? catRaw : catRaw instanceof Date ? catRaw.toISOString() : null;
  if (createdAtIso == null) return null;
  return {
    version: SAVED_MELODY_SCHEMA_VERSION,
    id: o.id,
    title: o.title,
    createdAtIso,
    notes: o.notes as SavedMelodyPayload['notes'],
  };
}

/** Identificator stabil Kinde (`sub` din token sau `id` din profil). */
export async function getKindeSubject(kinde: KindeSubjectProvider): Promise<string | null> {
  const decoded = (await kinde.getDecodedToken()) as Record<string, unknown> | null;
  const sub = decoded && typeof decoded.sub === 'string' ? decoded.sub : null;
  if (sub != null && sub.length > 0) return sub;
  const profile = await kinde.getUserProfile();
  const o = profile as Record<string, unknown> | null;
  const id = o && typeof o.id === 'string' ? o.id : null;
  return id != null && id.length > 0 ? id : null;
}

export async function listCloudMelodies(kindeSub: string): Promise<SavedMelodySummary[]> {
  if (supabase == null) return [];
  const { data, error } = await supabase
    .from('melodies')
    .select('id, title, created_at_iso, notes')
    .eq('kinde_sub', kindeSub)
    .order('created_at_iso', { ascending: false });
  if (error != null || data == null) return [];
  const out: SavedMelodySummary[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const notes = row.notes;
    const noteCount = Array.isArray(notes) ? notes.length : 0;
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.created_at_iso !== 'string') continue;
    out.push({
      id: row.id,
      title: row.title,
      createdAtIso: row.created_at_iso,
      noteCount,
    });
  }
  return out;
}

export async function fetchCloudMelody(kindeSub: string, id: string): Promise<SavedMelodyPayload | null> {
  if (supabase == null) return null;
  const { data, error } = await supabase
    .from('melodies')
    .select('schema_version, id, title, notes, created_at_iso')
    .eq('kinde_sub', kindeSub)
    .eq('id', id)
    .maybeSingle();
  if (error != null || data == null) return null;
  return rowToPayload(data as Record<string, unknown>);
}

export async function upsertCloudMelody(kindeSub: string, payload: SavedMelodyPayload): Promise<void> {
  if (supabase == null) throw new Error('Supabase nu e configurat.');
  const row = {
    kinde_sub: kindeSub,
    id: payload.id,
    schema_version: payload.version,
    title: payload.title,
    notes: payload.notes,
    created_at_iso: payload.createdAtIso,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('melodies').upsert(row, { onConflict: 'kinde_sub,id' });
  if (error != null) throw new Error(error.message);
}

export async function deleteCloudMelody(kindeSub: string, id: string): Promise<void> {
  if (supabase == null) throw new Error('Supabase nu e configurat.');
  const { error } = await supabase.from('melodies').delete().eq('kinde_sub', kindeSub).eq('id', id);
  if (error != null) throw new Error(error.message);
}
