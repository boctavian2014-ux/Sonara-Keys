import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '../../components/ui/GlassCard';
import { GradientScreenBackground } from '../../components/ui/GradientScreenBackground';
import { ListenHeroButton } from '../../components/ui/ListenHeroButton';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors, layout, radius, sonaraTheme, spacing, typography } from '../../theme';
import { midiToFrequency, sortNotesByTime } from '../audio/midiUtils';
import { ToneSynth } from '../audio/ToneSynth';
import {
  listSavedMelodies,
  loadSavedMelody,
  saveMelodyToLibrary,
  deleteSavedMelody,
  writeMelodyPayloadToDisk,
} from '../audio/melodyLibrary';
import { shareSessionMidi, shareSessionNotesJson, shareSessionStaffSvg } from '../audio/sessionShare';
import { useAudioToMidi } from '../audio/useAudioToMidi';
import { useNoteDetection } from '../audio/useNoteDetection';
import { SheetMusicView } from '../components/SheetMusicView';
import { analyzeScore } from '../audio/scoreAnalyze';

import type { DetectedNote } from '../../types/notes';
import type { PracticeOpenSource } from '../../types/practiceRoute';
import type { SavedMelodySummary } from '../../types/savedMelody';
import { getKindeAuthConfig } from '../auth/kindeConfig';
import { useOptionalKinde } from '../auth/useOptionalKinde';
import {
  deleteCloudMelody,
  fetchCloudMelody,
  getKindeSubject,
  listCloudMelodies,
  upsertCloudMelody,
} from '../lib/melodyRemote';
import { isSupabaseConfigured } from '../lib/supabase';

type HomeScreenProps = {
  onOpenPractice: (route: PracticeOpenSource) => void;
};

function statusPillLabel(
  isStartingMic: boolean,
  isModelLoaded: boolean,
  isListening: boolean,
  isProcessing: boolean,
  noteCount: number,
): string {
  if (isProcessing) return 'Transcribing…';
  if (isStartingMic) return 'Starting…';
  if (isListening) return 'Listening';
  if (!isModelLoaded) return 'Loading AI…';
  if (noteCount > 0) return 'Stopped';
  return 'Ready';
}

function octaveChipColors(octave: number): { bg: string; border: string } {
  if (octave <= 3) return { bg: 'rgba(59,130,246,0.22)', border: 'rgba(59,130,246,0.45)' };
  if (octave === 4) return { bg: 'rgba(45,212,191,0.18)', border: 'rgba(45,212,191,0.42)' };
  return { bg: 'rgba(52,211,153,0.18)', border: 'rgba(52,211,153,0.42)' };
}

export default function HomeScreen({ onOpenPractice }: HomeScreenProps) {
  const { width, height: windowHeight } = useWindowDimensions();
  const detection = useNoteDetection();
  const detectionRef = useRef(detection);
  detectionRef.current = detection;
  const audioImport = useAudioToMidi();
  const audioImportRef = useRef(audioImport);
  audioImportRef.current = audioImport;

  const webBlock = Platform.OS === 'web';

  const [savedMelodies, setSavedMelodies] = useState<SavedMelodySummary[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitleDraft, setSaveTitleDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kindeProfileLine, setKindeProfileLine] = useState<string | null>(null);
  const [kindeAuthBusy, setKindeAuthBusy] = useState(false);
  const [cloudMelodies, setCloudMelodies] = useState<SavedMelodySummary[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [kindeSubForCloud, setKindeSubForCloud] = useState<string | null>(null);
  const [staffExpanded, setStaffExpanded] = useState(false);

  const kinde = useOptionalKinde();
  const kindeRef = useRef(kinde);
  kindeRef.current = kinde;
  const kindeEnvConfigured = useMemo(() => getKindeAuthConfig() != null, []);
  const cloudSyncReady = useMemo(
    () => !webBlock && kinde?.isAuthenticated === true && isSupabaseConfigured(),
    [webBlock, kinde?.isAuthenticated],
  );

  const transcribeUrlHint = useMemo(() => {
    const u =
      typeof process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL === 'string'
        ? process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL.trim()
        : '';
    return u.length > 0 ? u : 'Nu e setat (adaugă EXPO_PUBLIC_TRANSCRIBE_API_URL în .env).';
  }, []);

  const scoreAnalysis = useMemo(() => {
    // Only run heavier analysis when user stopped listening and transcription finished.
    if (webBlock) return null;
    if (detection.isListening || detection.isStartingMic || detection.isProcessing) return null;
    if (detection.detectedNotes.length === 0) return null;
    try {
      return analyzeScore(detection.detectedNotes);
    } catch {
      return null;
    }
  }, [webBlock, detection.isListening, detection.isStartingMic, detection.isProcessing, detection.detectedNotes]);

  const appVersionLabel = useMemo(() => {
    const v = Constants.expoConfig?.version ?? Constants.nativeAppVersion;
    return typeof v === 'string' && v.length > 0 ? v : '—';
  }, []);

  const refreshSavedMelodies = useCallback(async () => {
    try {
      const list = await listSavedMelodies();
      setSavedMelodies(list);
    } catch {
      setSavedMelodies([]);
    }
  }, []);

  useEffect(() => {
    void refreshSavedMelodies();
  }, [refreshSavedMelodies]);

  useEffect(() => {
    void detection.requestPermission();
  }, [detection.requestPermission]);

  useEffect(() => {
    const activeKinde = kindeRef.current;
    if (!settingsOpen || activeKinde == null || !activeKinde.isAuthenticated) {
      setKindeProfileLine(null);
      return;
    }
    let cancelled = false;
    void activeKinde.getUserProfile().then((p) => {
      if (cancelled || p == null) return;
      const o = p as Record<string, unknown>;
      const email = typeof o.email === 'string' ? o.email : '';
      const given = typeof o.given_name === 'string' ? o.given_name : '';
      const family = typeof o.family_name === 'string' ? o.family_name : '';
      const name = [given, family].filter((s) => s.length > 0).join(' ') || '—';
      setKindeProfileLine(`${name}${email ? ` · ${email}` : ''}`);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, kinde?.isAuthenticated]);

  useEffect(() => {
    const activeKinde = kindeRef.current;
    if (!cloudSyncReady || activeKinde == null) {
      setCloudMelodies([]);
      setKindeSubForCloud(null);
      return;
    }
    let cancelled = false;
    setCloudBusy(true);
    void (async () => {
      const sub = await getKindeSubject(activeKinde);
      if (cancelled) return;
      if (sub == null) {
        setKindeSubForCloud(null);
        setCloudMelodies([]);
        setCloudBusy(false);
        return;
      }
      setKindeSubForCloud(sub);
      try {
        const list = await listCloudMelodies(sub);
        if (!cancelled) setCloudMelodies(list);
      } catch {
        if (!cancelled) setCloudMelodies([]);
      } finally {
        if (!cancelled) setCloudBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudSyncReady, kinde?.isAuthenticated]);

  const onRefreshCloudList = useCallback(async () => {
    if (kindeSubForCloud == null) return;
    setCloudBusy(true);
    try {
      const list = await listCloudMelodies(kindeSubForCloud);
      setCloudMelodies(list);
    } catch (e) {
      Alert.alert('Cloud', e instanceof Error ? e.message : 'Nu s-a putut actualiza lista.');
    } finally {
      setCloudBusy(false);
    }
  }, [kindeSubForCloud]);

  const onUploadAllLocalToCloud = useCallback(async () => {
    if (kindeSubForCloud == null || webBlock) return;
    setCloudBusy(true);
    try {
      for (const m of savedMelodies) {
        const full = await loadSavedMelody(m.id);
        if (full != null) await upsertCloudMelody(kindeSubForCloud, full);
      }
      const list = await listCloudMelodies(kindeSubForCloud);
      setCloudMelodies(list);
      Alert.alert('Cloud', 'Melodiile locale au fost încărcate.');
    } catch (e) {
      Alert.alert('Cloud', e instanceof Error ? e.message : 'Eroare la încărcare.');
    } finally {
      setCloudBusy(false);
    }
  }, [kindeSubForCloud, webBlock, savedMelodies]);

  const onDownloadCloudMelody = useCallback(
    async (id: string) => {
      if (kindeSubForCloud == null || webBlock) return;
      setCloudBusy(true);
      try {
        const payload = await fetchCloudMelody(kindeSubForCloud, id);
        if (payload == null) {
          Alert.alert('Cloud', 'Melodia nu a fost găsită sau formatul nu e acceptat.');
          return;
        }
        await writeMelodyPayloadToDisk(payload);
        await refreshSavedMelodies();
        Alert.alert('Bibliotecă', 'Melodia a fost salvată local.');
      } catch (e) {
        Alert.alert('Cloud', e instanceof Error ? e.message : 'Eroare la descărcare.');
      } finally {
        setCloudBusy(false);
      }
    },
    [kindeSubForCloud, webBlock, refreshSavedMelodies],
  );

  const onDeleteCloudMelody = useCallback(
    (id: string, title: string) => {
      if (kindeSubForCloud == null) return;
      Alert.alert('Șterge din cloud', `Sigur ștergi „${title}” din cloud?`, [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCloudBusy(true);
              try {
                await deleteCloudMelody(kindeSubForCloud, id);
                const list = await listCloudMelodies(kindeSubForCloud);
                setCloudMelodies(list);
              } catch (e) {
                Alert.alert('Cloud', e instanceof Error ? e.message : 'Eroare.');
              } finally {
                setCloudBusy(false);
              }
            })();
          },
        },
      ]);
    },
    [kindeSubForCloud],
  );

  const onKindeLogin = useCallback(async () => {
    if (kinde == null) return;
    setKindeAuthBusy(true);
    try {
      await kinde.login({});
    } catch (e) {
      Alert.alert('Autentificare', e instanceof Error ? e.message : 'A eșuat conectarea.');
    } finally {
      setKindeAuthBusy(false);
    }
  }, [kinde]);

  const onKindeRegister = useCallback(async () => {
    if (kinde == null) return;
    setKindeAuthBusy(true);
    try {
      await kinde.register({});
    } catch (e) {
      Alert.alert('Înregistrare', e instanceof Error ? e.message : 'A eșuat.');
    } finally {
      setKindeAuthBusy(false);
    }
  }, [kinde]);

  const onKindeLogout = useCallback(async () => {
    if (kinde == null) return;
    setKindeAuthBusy(true);
    try {
      await kinde.logout({ revokeToken: true });
      setKindeProfileLine(null);
    } catch (e) {
      Alert.alert('Ieșire', e instanceof Error ? e.message : 'A eșuat.');
    } finally {
      setKindeAuthBusy(false);
    }
  }, [kinde]);

  const staffW = Math.max(200, width - 40);
  const staffExpandedInnerHeight = Math.round(Math.min(windowHeight * 0.72, 560));

  const onHeroPress = useCallback(() => {
    if (Platform.OS === 'web') return;
    const ai = audioImportRef.current;
    if (ai.phase === 'recording' || ai.phase === 'processing') return;
    const d = detectionRef.current;
    if (d.isProcessing) return;
    if (d.isListening || d.isStartingMic) {
      void d.stopListening();
    } else {
      void d.startListening();
    }
  }, []);

  const recentEight = useMemo(() => {
    const s = sortNotesByTime(detection.detectedNotes);
    return s.slice(Math.max(0, s.length - 8));
  }, [detection.detectedNotes]);

  const current = detection.currentNote;
  const hz = current != null ? midiToFrequency(current.midi) : null;
  const durMs =
    current != null ? Math.max(0, Math.round((current.endTime - current.startTime) * 1000)) : null;

  const onChipPress = useCallback((n: DetectedNote) => {
    void ToneSynth.playNote(n.midi, 400);
  }, []);

  const onSaveStaffSvg = useCallback(() => {
    void shareSessionStaffSvg(detection.detectedNotes);
  }, [detection.detectedNotes]);

  const onExportJson = useCallback(() => {
    void shareSessionNotesJson(detection.detectedNotes);
  }, [detection.detectedNotes]);

  const onExportMidi = useCallback(() => {
    void shareSessionMidi(detection.detectedNotes);
  }, [detection.detectedNotes]);

  const openSaveMelodyModal = useCallback(() => {
    const d = sortNotesByTime(detection.detectedNotes);
    if (d.length === 0) return;
    setSaveTitleDraft(`Melodie ${new Date().toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}`);
    setSaveModalOpen(true);
  }, [detection.detectedNotes]);

  const confirmSaveMelody = useCallback(async () => {
    const d = sortNotesByTime(detection.detectedNotes);
    if (d.length === 0) return;
    try {
      await saveMelodyToLibrary(saveTitleDraft, d);
      setSaveModalOpen(false);
      await refreshSavedMelodies();
    } catch (e) {
      Alert.alert('Salvare', e instanceof Error ? e.message : 'Nu s-a putut salva melodia.');
    }
  }, [detection.detectedNotes, saveTitleDraft, refreshSavedMelodies]);

  const onPracticeSaved = useCallback(
    async (id: string) => {
      const full = await loadSavedMelody(id);
      if (full == null) {
        Alert.alert('Melodie', 'Fișierul nu a fost găsit.');
        return;
      }
      onOpenPractice({ kind: 'saved', saved: full });
    },
    [onOpenPractice],
  );

  const onShareSavedSvg = useCallback(async (id: string) => {
    const full = await loadSavedMelody(id);
    if (full == null) {
      Alert.alert('Melodie', 'Fișierul nu a fost găsit.');
      return;
    }
    void shareSessionStaffSvg(full.notes);
  }, []);

  const onShareSavedJson = useCallback(async (id: string) => {
    const full = await loadSavedMelody(id);
    if (full == null) {
      Alert.alert('Melodie', 'Fișierul nu a fost găsit.');
      return;
    }
    void shareSessionNotesJson(full.notes);
  }, []);

  const onShareSavedMidi = useCallback(async (id: string) => {
    const full = await loadSavedMelody(id);
    if (full == null) {
      Alert.alert('Melodie', 'Fișierul nu a fost găsit.');
      return;
    }
    void shareSessionMidi(full.notes);
  }, []);

  const onAudioImportPress = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const d = detectionRef.current;
    const ai = audioImportRef.current;
    if (d.isListening || d.isStartingMic || d.isProcessing) {
      Alert.alert(
        'Import audio',
        'Oprește ascultarea live și transcrierea sesiunii înainte de a importa din audio.',
      );
      return;
    }
    if (ai.phase === 'processing') return;

    if (ai.phase === 'recording') {
      const r = await ai.stopAndTranscribe();
      if (!r.ok) {
        Alert.alert('Import audio', r.error);
        ai.reset();
        return;
      }
      const title = `Melodie din audio ${new Date().toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}`;
      try {
        const payload = await saveMelodyToLibrary(title, r.notes);
        await refreshSavedMelodies();
        onOpenPractice({ kind: 'saved', saved: payload });
        ai.reset();
      } catch (e) {
        Alert.alert('Import audio', e instanceof Error ? e.message : 'Nu s-a putut salva melodia.');
        ai.reset();
      }
      return;
    }

    if (ai.phase === 'error' || ai.phase === 'done') {
      ai.reset();
    }

    const started = await ai.startRecording();
    if (!started.ok) {
      Alert.alert('Import audio', started.error);
    }
  }, [refreshSavedMelodies, onOpenPractice]);

  const onDeleteSaved = useCallback(
    (id: string, title: string) => {
      Alert.alert('Șterge melodia', `Sigur ștergi „${title}”?`, [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteSavedMelody(id);
              await refreshSavedMelodies();
            })();
          },
        },
      ]);
    },
    [refreshSavedMelodies],
  );

  const pillLabel = statusPillLabel(
    detection.isStartingMic,
    detection.isModelLoaded,
    detection.isListening,
    detection.isProcessing,
    detection.detectedNotes.length,
  );

  const subline = detection.isProcessing
    ? `Se analizează melodia${detection.transcriptionProgress != null ? ` (${detection.transcriptionProgress}%)` : ''}… așteaptă până la note pe portativ.`
    : detection.isListening
      ? 'Ascultă melodia… apasă din nou ca să oprești și să pună notele pe portativ.'
      : detection.isStartingMic
        ? 'Starting microphone…'
        : !detection.isModelLoaded
          ? 'Se pregătește…'
          : 'Pune o melodie lângă microfon, apoi apasă pentru înregistrare.';

  return (
    <GradientScreenBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="home-screen">
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.column, { maxWidth: layout.maxContentWidth, alignSelf: 'center' }]}>
            <ScreenHeader
              title={sonaraTheme.brand.name}
              subtitle={sonaraTheme.brand.tagline}
              onAccountPress={
                !webBlock && kindeEnvConfigured ? () => setSettingsOpen(true) : undefined
              }
              onSettingsPress={() => setSettingsOpen(true)}
            />

            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusPill,
                  (detection.isListening || detection.isStartingMic) && styles.statusPillLive,
                  !detection.isModelLoaded && !detection.isListening && !detection.isStartingMic && styles.statusPillMuted,
                ]}
              >
                {!detection.isModelLoaded && !detection.isListening && !detection.isStartingMic ? (
                  <ActivityIndicator size="small" color={colors.accentTeal} style={styles.pillSpinner} />
                ) : detection.isStartingMic ? (
                  <ActivityIndicator size="small" color={colors.accentTeal} style={styles.pillSpinner} />
                ) : null}
                <Text style={styles.statusPillText}>{pillLabel}</Text>
              </View>
            </View>

            {webBlock ? (
              <GlassCard style={styles.banner}>
                <Text style={styles.bannerText}>
                  Live transcription needs a native build (Expo dev client) with the microphone module.
                </Text>
              </GlassCard>
            ) : null}

            {detection.micError ? (
              <GlassCard style={styles.banner}>
                <Text style={styles.bannerText}>{detection.micError}</Text>
              </GlassCard>
            ) : null}

            {detection.transcriptionError ? (
              <GlassCard style={styles.banner}>
                <Text style={styles.bannerText}>Transcriere: {detection.transcriptionError}</Text>
              </GlassCard>
            ) : null}

            {audioImport.error != null && audioImport.phase === 'error' ? (
              <GlassCard style={styles.banner}>
                <Text style={styles.bannerText}>Import audio: {audioImport.error}</Text>
              </GlassCard>
            ) : null}

            <Pressable
              onPress={() => setStaffExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                staffExpanded ? 'Restrânge portativul' : 'Extinde portativul pe mai multe linii'
              }
            >
              <GlassCard style={[styles.staffCard, staffExpanded && styles.staffCardExpanded]}>
                <Text style={styles.staffExpandHint}>
                  {staffExpanded
                    ? 'Apasă din nou pentru portativ compact'
                    : 'Apasă aici pentru portativ mare (mai multe linii)'}
                </Text>
                <SheetMusicView
                  notes={detection.detectedNotes}
                  analysis={scoreAnalysis}
                  isListening={detection.isListening || detection.isStartingMic}
                  isTranscribing={detection.isProcessing}
                  isModelLoaded={detection.isModelLoaded}
                  width={staffW}
                  height={staffExpanded ? staffExpandedInnerHeight : 130}
                  multilineStaff={staffExpanded}
                  clampSvgHeight={!staffExpanded}
                />
              </GlassCard>
            </Pressable>

            <View style={styles.heroBlock}>
              <ListenHeroButton
                isListening={detection.isListening}
                busy={detection.isStartingMic || detection.isProcessing}
                disabled={webBlock || audioImport.phase === 'recording' || audioImport.phase === 'processing'}
                onPress={onHeroPress}
              />
              <Text style={styles.heroHint}>{webBlock ? 'Use iOS or Android build' : subline}</Text>
              <Pressable
                onPress={() => void onAudioImportPress()}
                disabled={
                  webBlock ||
                  detection.isListening ||
                  detection.isStartingMic ||
                  detection.isProcessing ||
                  audioImport.phase === 'processing'
                }
                style={({ pressed }) => [
                  styles.actionSecondary,
                  styles.importAudioBtn,
                  (webBlock ||
                    detection.isListening ||
                    detection.isStartingMic ||
                    detection.isProcessing ||
                    audioImport.phase === 'processing') &&
                    styles.actionDisabled,
                  pressed &&
                    !(
                      webBlock ||
                      detection.isListening ||
                      detection.isStartingMic ||
                      detection.isProcessing ||
                      audioImport.phase === 'processing'
                    ) &&
                    styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  audioImport.phase === 'recording'
                    ? 'Oprește înregistrarea și trimite la server'
                    : 'Importă din audio pe server'
                }
              >
                {audioImport.phase === 'processing' ? (
                  <View style={styles.importAudioRow}>
                    <ActivityIndicator size="small" color={colors.accentTeal} />
                    <Text style={styles.actionSecondaryText}>Transcriere pe server…</Text>
                  </View>
                ) : (
                  <Text style={styles.actionSecondaryText}>
                    {audioImport.phase === 'recording'
                      ? 'Oprește și trimite la PC (Basic Pitch)'
                      : 'Importă din audio (server PC)'}
                  </Text>
                )}
              </Pressable>
              {!webBlock ? (
                <Text style={styles.importAudioHint}>
                  Înregistrezi direct la microfon; audio merge ca WAV la URL-ul din EXPO_PUBLIC_TRANSCRIBE_API_URL.
                </Text>
              ) : null}
            </View>

            <GlassCard style={styles.currentCard}>
              <Text style={styles.cardLabel}>Current</Text>
              {current ? (
                <>
                  <Text style={styles.currentMain}>
                    {current.name}
                    {current.octave} | MIDI {current.midi}
                  </Text>
                  <Text style={styles.currentMeta}>
                    {hz != null ? `${hz.toFixed(1)} Hz` : '—'} | {durMs != null ? `${(durMs / 1000).toFixed(2)}s duration` : '—'}
                  </Text>
                </>
              ) : (
                <Text style={styles.currentEmpty}>—</Text>
              )}
            </GlassCard>

            <GlassCard style={styles.sessionCard}>
              <View style={styles.sessionHeader}>
                <Text style={styles.sessionTitle}>
                  Session notes ({detection.detectedNotes.length})
                </Text>
                <Pressable
                  onPress={detection.clearNotes}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear session notes"
                >
                  <Text style={styles.clearGlyph}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.chipWrap}>
                {recentEight.map((n) => {
                  const oc = octaveChipColors(n.octave);
                  return (
                    <Pressable
                      key={n.id}
                      onPress={() => onChipPress(n)}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: oc.bg, borderColor: oc.border },
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Text style={styles.chipText}>
                        {n.name}
                        {n.octave}
                      </Text>
                    </Pressable>
                  );
                })}
                {recentEight.length === 0 ? (
                  <Text style={styles.chipEmpty}>Notele apar după ce oprești ascultarea.</Text>
                ) : null}
              </View>
            </GlassCard>

            {!detection.isListening && detection.detectedNotes.length > 0 ? (
              <Text style={styles.sessionSummary}>
                Detected {detection.detectedNotes.length} notes · {detection.sessionDurationSeconds.toFixed(1)}s
                listened
              </Text>
            ) : null}

            <GlassCard style={styles.libraryCard}>
              <Text style={styles.libraryTitle}>Melodii salvate (local)</Text>
              {savedMelodies.length === 0 ? (
                <Text style={styles.libraryEmpty}>
                  {webBlock ? 'Biblioteca nu e disponibilă pe web.' : 'Nicio melodie salvată încă. Salvează după ce ai note pe portativ.'}
                </Text>
              ) : (
                savedMelodies.map((m) => (
                  <View key={m.id} style={styles.libraryRow}>
                    <View style={styles.libraryRowText}>
                      <Text style={styles.libraryRowTitle} numberOfLines={1}>
                        {m.title}
                      </Text>
                      <Text style={styles.libraryRowMeta}>
                        {m.noteCount} note · {new Date(m.createdAtIso).toLocaleString('ro-RO')}
                      </Text>
                    </View>
                    <View style={styles.libraryRowActions}>
                      <Pressable
                        onPress={() => void onPracticeSaved(m.id)}
                        style={({ pressed }) => [styles.libraryMiniBtn, pressed && styles.actionPressed]}
                        disabled={webBlock}
                      >
                        <Text style={styles.libraryMiniBtnText}>Practice</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void onShareSavedSvg(m.id)}
                        style={({ pressed }) => [styles.libraryMiniBtnGhost, pressed && styles.actionPressed]}
                        disabled={webBlock}
                      >
                        <Text style={styles.libraryMiniBtnGhostText}>SVG</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void onShareSavedJson(m.id)}
                        style={({ pressed }) => [styles.libraryMiniBtnGhost, pressed && styles.actionPressed]}
                        disabled={webBlock}
                      >
                        <Text style={styles.libraryMiniBtnGhostText}>JSON</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void onShareSavedMidi(m.id)}
                        style={({ pressed }) => [styles.libraryMiniBtnGhost, pressed && styles.actionPressed]}
                        disabled={webBlock}
                      >
                        <Text style={styles.libraryMiniBtnGhostText}>MIDI</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onDeleteSaved(m.id, m.title)}
                        style={({ pressed }) => [styles.libraryMiniBtnDanger, pressed && styles.actionPressed]}
                        disabled={webBlock}
                      >
                        <Text style={styles.libraryMiniBtnDangerText}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </GlassCard>

            <GlassCard style={styles.libraryCard}>
              <View style={styles.cloudHeaderRow}>
                <Text style={styles.libraryTitle}>Melodii în cloud</Text>
                {cloudBusy ? <ActivityIndicator color={colors.textSecondary} /> : null}
              </View>
              {!cloudSyncReady ? (
                <Text style={styles.libraryEmpty}>
                  {webBlock
                    ? 'Sincronizarea cloud nu e disponibilă pe web.'
                    : !isSupabaseConfigured()
                      ? 'Adaugă EXPO_PUBLIC_SUPABASE_URL și EXPO_PUBLIC_SUPABASE_ANON_KEY în .env pentru cloud.'
                      : 'Conectează-te cu Kinde ca să vezi și să sincronizezi melodiile în cloud.'}
                </Text>
              ) : cloudMelodies.length === 0 ? (
                <Text style={styles.libraryEmpty}>Nicio melodie în cloud încă. Poți încărca biblioteca locală.</Text>
              ) : (
                cloudMelodies.map((m) => (
                  <View key={m.id} style={styles.libraryRow}>
                    <View style={styles.libraryRowText}>
                      <Text style={styles.libraryRowTitle} numberOfLines={1}>
                        {m.title}
                      </Text>
                      <Text style={styles.libraryRowMeta}>
                        {m.noteCount} note · {new Date(m.createdAtIso).toLocaleString('ro-RO')}
                      </Text>
                    </View>
                    <View style={styles.libraryRowActions}>
                      <Pressable
                        onPress={() => void onDownloadCloudMelody(m.id)}
                        style={({ pressed }) => [styles.libraryMiniBtn, pressed && styles.actionPressed]}
                        disabled={cloudBusy}
                      >
                        <Text style={styles.libraryMiniBtnText}>Local</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onDeleteCloudMelody(m.id, m.title)}
                        style={({ pressed }) => [styles.libraryMiniBtnDanger, pressed && styles.actionPressed]}
                        disabled={cloudBusy}
                      >
                        <Text style={styles.libraryMiniBtnDangerText}>Cloud ✕</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
              {cloudSyncReady ? (
                <View style={styles.cloudToolbar}>
                  <Pressable
                    onPress={() => void onUploadAllLocalToCloud()}
                    style={({ pressed }) => [styles.libraryMiniBtn, pressed && styles.actionPressed]}
                    disabled={cloudBusy || savedMelodies.length === 0}
                  >
                    <Text style={styles.libraryMiniBtnText}>Încarcă localele</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void onRefreshCloudList()}
                    style={({ pressed }) => [styles.libraryMiniBtnGhost, pressed && styles.actionPressed]}
                    disabled={cloudBusy}
                  >
                    <Text style={styles.libraryMiniBtnGhostText}>Actualizează</Text>
                  </Pressable>
                </View>
              ) : null}
            </GlassCard>

            <View style={styles.actions}>
              <Pressable
                onPress={() => onOpenPractice({ kind: 'sample' })}
                style={({ pressed }) => [styles.actionPrimary, pressed && styles.actionPressed]}
                accessibilityRole="button"
              >
                <Text style={styles.actionPrimaryText}>Practice (exemplu)</Text>
              </Pressable>
              <Pressable
                onPress={openSaveMelodyModal}
                disabled={webBlock || detection.detectedNotes.length === 0}
                style={({ pressed }) => [
                  styles.actionSecondary,
                  (webBlock || detection.detectedNotes.length === 0) && styles.actionDisabled,
                  pressed && !(webBlock || detection.detectedNotes.length === 0) && styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Salvează melodia în bibliotecă"
              >
                <Text style={styles.actionSecondaryText}>Salvează melodia în bibliotecă</Text>
              </Pressable>
              <Pressable
                onPress={onSaveStaffSvg}
                disabled={webBlock || detection.detectedNotes.length === 0}
                style={({ pressed }) => [
                  styles.actionSecondary,
                  (webBlock || detection.detectedNotes.length === 0) && styles.actionDisabled,
                  pressed && !(webBlock || detection.detectedNotes.length === 0) && styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Salvează portativul ca SVG"
              >
                <Text style={styles.actionSecondaryText}>Salvează portativ (SVG)</Text>
              </Pressable>
              <Pressable
                onPress={onExportJson}
                disabled={webBlock || detection.detectedNotes.length === 0}
                style={({ pressed }) => [
                  styles.actionSecondary,
                  (webBlock || detection.detectedNotes.length === 0) && styles.actionDisabled,
                  pressed && !(webBlock || detection.detectedNotes.length === 0) && styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Export note JSON"
              >
                <Text style={styles.actionSecondaryText}>Export note (JSON)</Text>
              </Pressable>
              <Pressable
                onPress={onExportMidi}
                disabled={webBlock || detection.detectedNotes.length === 0}
                style={({ pressed }) => [
                  styles.actionSecondary,
                  (webBlock || detection.detectedNotes.length === 0) && styles.actionDisabled,
                  pressed && !(webBlock || detection.detectedNotes.length === 0) && styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Export sesiune MIDI"
              >
                <Text style={styles.actionSecondaryText}>Export MIDI (sesiune)</Text>
              </Pressable>
            </View>

            <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
              <View style={styles.modalBackdrop}>
                <GlassCard style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Setări și informații</Text>
                  <ScrollView style={styles.settingsScroll} keyboardShouldPersistTaps="handled">
                    <Text style={styles.settingsLabel}>Versiune aplicație</Text>
                    <Text style={styles.settingsValue}>{appVersionLabel}</Text>
                    <Text style={styles.settingsLabel}>Server transcriere (env)</Text>
                    <Text style={styles.settingsValue} selectable>
                      {transcribeUrlHint}
                    </Text>
                    <Text style={styles.settingsLabel}>Dezvoltare USB</Text>
                    <Text style={styles.settingsValue}>
                      Pornește Metro cu reverse ADB: npm run dev:usb (vezi docs/local-basic-pitch.md).
                    </Text>

                    <Text style={styles.settingsLabel}>Cont (Kinde)</Text>
                    {!kindeEnvConfigured ? (
                      <Text style={styles.settingsValue}>
                        Adaugă în .env: EXPO_PUBLIC_KINDE_DOMAIN și EXPO_PUBLIC_KINDE_CLIENT_ID, apoi repornește
                        bundler-ul. În Kinde → Applications → Callback URLs include sonarakeys://kinde_callback
                        (scheme din app.json).
                      </Text>
                    ) : kinde == null ? (
                      <Text style={styles.settingsValue}>
                        {webBlock
                          ? 'Autentificarea Kinde este disponibilă în build-ul nativ (Android / iOS), nu în browser.'
                          : 'Kinde nu e disponibil în acest build. Verifică că ai repornit Metro după ce ai setat .env.'}
                      </Text>
                    ) : kinde.isLoading ? (
                      <ActivityIndicator color={colors.accentTeal} style={{ marginVertical: spacing.sm }} />
                    ) : kinde.isAuthenticated ? (
                      <>
                        <Text style={styles.settingsValue}>{kindeProfileLine ?? 'Se încarcă profilul…'}</Text>
                        <Pressable
                          onPress={() => void onKindeLogout()}
                          disabled={kindeAuthBusy}
                          style={({ pressed }) => [
                            styles.modalBtnGhost,
                            styles.kindeAuthBtn,
                            kindeAuthBusy && styles.actionDisabled,
                            pressed && !kindeAuthBusy && styles.actionPressed,
                          ]}
                        >
                          <Text style={styles.modalBtnGhostText}>Ieșire din cont</Text>
                        </Pressable>
                      </>
                    ) : (
                      <View style={styles.kindeAuthRow}>
                        <Pressable
                          onPress={() => void onKindeLogin()}
                          disabled={kindeAuthBusy}
                          style={({ pressed }) => [
                            styles.modalBtnPrimary,
                            styles.kindeAuthBtnFlex,
                            kindeAuthBusy && styles.actionDisabled,
                            pressed && !kindeAuthBusy && styles.actionPressed,
                          ]}
                        >
                          <Text style={styles.modalBtnPrimaryText}>Autentificare</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void onKindeRegister()}
                          disabled={kindeAuthBusy}
                          style={({ pressed }) => [
                            styles.modalBtnGhost,
                            styles.kindeAuthBtnFlex,
                            kindeAuthBusy && styles.actionDisabled,
                            pressed && !kindeAuthBusy && styles.actionPressed,
                          ]}
                        >
                          <Text style={styles.modalBtnGhostText}>Înregistrare</Text>
                        </Pressable>
                      </View>
                    )}
                  </ScrollView>
                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => setSettingsOpen(false)}
                      style={({ pressed }) => [styles.modalBtnPrimary, pressed && styles.actionPressed]}
                    >
                      <Text style={styles.modalBtnPrimaryText}>Închide</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              </View>
            </Modal>

            <Modal visible={saveModalOpen} transparent animationType="fade" onRequestClose={() => setSaveModalOpen(false)}>
              <View style={styles.modalBackdrop}>
                <GlassCard style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Salvează melodia</Text>
                  <Text style={styles.modalHint}>Titlu (afișat în Practice și în listă)</Text>
                  <TextInput
                    value={saveTitleDraft}
                    onChangeText={setSaveTitleDraft}
                    placeholder="Titlu melodie"
                    placeholderTextColor="rgba(148,163,184,0.7)"
                    style={styles.modalInput}
                    autoFocus
                  />
                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => setSaveModalOpen(false)}
                      style={({ pressed }) => [styles.modalBtnGhost, pressed && styles.actionPressed]}
                    >
                      <Text style={styles.modalBtnGhostText}>Anulează</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void confirmSaveMelody()}
                      style={({ pressed }) => [styles.modalBtnPrimary, pressed && styles.actionPressed]}
                    >
                      <Text style={styles.modalBtnPrimaryText}>Salvează</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              </View>
            </Modal>
          </View>
        </ScrollView>
      </SafeAreaView>
    </GradientScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.sm,
  },
  column: { width: '100%' },
  statusRow: { alignItems: 'center', marginBottom: spacing.md },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statusPillLive: {
    borderColor: 'rgba(52,211,153,0.45)',
    backgroundColor: 'rgba(52,211,153,0.12)',
  },
  statusPillMuted: { opacity: 0.85 },
  pillSpinner: { marginRight: 2 },
  statusPillText: { ...typography.bodySemibold, color: colors.textPrimary },
  banner: { marginBottom: spacing.md },
  bannerText: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  staffCard: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    overflow: 'hidden',
  },
  staffCardExpanded: {
    paddingVertical: spacing.md,
  },
  staffExpandHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  heroBlock: { alignItems: 'center', marginBottom: spacing.xl },
  heroHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  importAudioBtn: { marginTop: spacing.lg, alignSelf: 'stretch', maxWidth: layout.maxContentWidth },
  importAudioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  importAudioHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    maxWidth: layout.maxContentWidth,
  },
  currentCard: { marginBottom: spacing.lg, paddingVertical: spacing.md },
  cardLabel: { ...typography.micro, color: colors.textMuted, marginBottom: spacing.xs },
  currentMain: { ...typography.title, color: colors.textPrimary },
  currentMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  currentEmpty: { ...typography.heroNote, color: colors.textMuted, fontSize: 28 },
  sessionCard: { marginBottom: spacing.md },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sessionTitle: { ...typography.bodySemibold, color: colors.textPrimary },
  clearGlyph: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipPressed: { opacity: 0.88 },
  chipText: { ...typography.bodySemibold, color: colors.textPrimary, fontSize: 13 },
  chipEmpty: { ...typography.caption, color: colors.textMuted },
  sessionSummary: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  actions: { gap: spacing.sm, alignItems: 'stretch' },
  actionPrimary: {
    backgroundColor: colors.accentBlue,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  actionSecondary: {
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionSecondaryText: { ...typography.bodySemibold, color: colors.textPrimary },
  actionDisabled: { opacity: 0.4 },
  actionPressed: { opacity: 0.92 },
  actionPrimaryText: { ...typography.bodySemibold, color: colors.textPrimary },
  actionGhost: {
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    opacity: 0.45,
  },
  actionGhostText: { ...typography.bodySemibold, color: colors.textMuted },
  libraryCard: { marginBottom: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  libraryTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
  libraryEmpty: { ...typography.caption, color: colors.textMuted, lineHeight: 20 },
  libraryRow: {
    flexDirection: 'column',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  libraryRowText: { gap: 2 },
  libraryRowTitle: { ...typography.bodySemibold, color: colors.textPrimary, fontSize: 15 },
  libraryRowMeta: { ...typography.caption, color: colors.textMuted },
  libraryRowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  libraryMiniBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.accentBlue,
  },
  libraryMiniBtnText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  libraryMiniBtnGhost: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  libraryMiniBtnGhostText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  libraryMiniBtnDanger: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(248,113,113,0.12)',
  },
  libraryMiniBtnDangerText: { ...typography.caption, color: '#fecaca', fontWeight: '700' },
  cloudHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cloudToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: { padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  modalHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalBtnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  modalBtnGhostText: { ...typography.bodySemibold, color: colors.textMuted },
  modalBtnPrimary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accentBlue,
  },
  modalBtnPrimaryText: { ...typography.bodySemibold, color: colors.textPrimary },
  settingsScroll: { maxHeight: 360, marginBottom: spacing.md },
  kindeAuthRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  kindeAuthBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  kindeAuthBtnFlex: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  settingsLabel: {
    ...typography.micro,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  settingsValue: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
});
