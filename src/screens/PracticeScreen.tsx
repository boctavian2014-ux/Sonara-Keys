import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { shareSessionMidi } from '../audio/sessionShare';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ToneSynth } from '../audio/ToneSynth';
import { useNotePlayback } from '../audio/useNotePlayback';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { PlaybackBar } from '../components/PlaybackBar';
import { SheetMusicView } from '../components/SheetMusicView';
import type { DetectedNote } from '../../types/notes';
import type { PracticeOpenSource } from '../../types/practiceRoute';
import {
  detectedNotesToPracticeNotes,
  normalizeDetectedTimesToZero,
  practiceMelodyToDetectedNotes,
  SAMPLE_MELODY,
} from '../data/melodies';
import { usePracticeSession } from '../hooks/usePracticeSession';
import { practiceTheme } from '../theme/practiceTheme';

const HEADER_H = 44;
const BOTTOM_BAR_H = 52;
const PILL_H = 36;
const BORDER_SUBTLE = 'rgba(151, 179, 255, 0.16)';

async function lockOrientation(kind: 'landscape' | 'portrait'): Promise<void> {
  try {
    const mod = require('expo-screen-orientation') as {
      lockAsync: (x: number) => Promise<void>;
      OrientationLock: { LANDSCAPE: number; PORTRAIT_UP: number };
    };
    await mod.lockAsync(kind === 'landscape' ? mod.OrientationLock.LANDSCAPE : mod.OrientationLock.PORTRAIT_UP);
  } catch {
    // Missing native module in current dev build: keep app running.
  }
}

export type PracticeScreenProps = {
  onBack: () => void;
  practiceOpen: PracticeOpenSource;
};

function statusPillLabel(status: string, autoMode: boolean): string {
  if (autoMode) return 'Playing';
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'listening':
      return 'Listening';
    case 'correct':
      return 'Correct';
    case 'wrong':
      return 'Try again';
    case 'complete':
      return 'Done';
    default:
      return '';
  }
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M11 5L6 9H3v6h3l5 4V5z"
        fill="none"
        stroke="#F4F7FF"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M15.54 8.46a5 5 0 010 7.07M17.66 6.34a8 8 0 010 11.32"
        fill="none"
        stroke="#F4F7FF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {muted ? (
        <Path
          d="M4 4l16 16"
          stroke="#F4F7FF"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ) : null}
    </Svg>
  );
}

export default function PracticeScreen({ onBack, practiceOpen }: PracticeScreenProps) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const practiceNotes = useMemo(() => {
    if (practiceOpen.kind === 'saved') {
      return detectedNotesToPracticeNotes(practiceOpen.saved.notes);
    }
    return SAMPLE_MELODY;
  }, [practiceOpen]);

  const staffPlaybackNotes = useMemo((): DetectedNote[] => {
    if (practiceOpen.kind === 'saved') {
      return normalizeDetectedTimesToZero(practiceOpen.saved.notes);
    }
    return practiceMelodyToDetectedNotes(SAMPLE_MELODY);
  }, [practiceOpen]);

  const session = usePracticeSession(practiceNotes);
  const celebratePlayback = useNotePlayback(staffPlaybackNotes);

  const practiceTitle =
    practiceOpen.kind === 'saved' ? practiceOpen.saved.title : 'Sonara Keys · practice';

  const [sheetLayout, setSheetLayout] = useState({ w: 0, h: 0 });
  const [keyboardLayout, setKeyboardLayout] = useState({ w: 0, h: 0 });

  const onSheetLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: lw, height: lh } = e.nativeEvent.layout;
    setSheetLayout({ w: lw, h: lh });
  }, []);

  const onKeyboardPanelLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: lw, height: lh } = e.nativeEvent.layout;
    setKeyboardLayout({ w: lw, h: lh });
  }, []);

  const { submitDetectedMidi, micError } = session;
  const handleKeyPress = useCallback((midi: number) => {
    if (Platform.OS === 'web') {
      void ToneSynth.playNote(midi, 400);
      return;
    }
    if (micError) return;
    submitDetectedMidi(midi);
  }, [submitDetectedMidi, micError]);

  useEffect(() => {
    let cancelled = false;
    void ToneSynth.preload();

    if (Platform.OS === 'web') {
      return () => {
        cancelled = true;
      };
    }

    const task = InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
      await lockOrientation('landscape');
    });

    return () => {
      cancelled = true;
      // Best-effort portrait restore on unmount
      void (async () => {
        await lockOrientation('portrait');
      })();
    };
  }, []);

  const practiceStaffNotes: DetectedNote[] = useMemo(() => {
    const upto = Math.min(session.currentIndex + 1, session.melody.length);
    return staffPlaybackNotes.slice(0, upto);
  }, [staffPlaybackNotes, session.currentIndex, session.melody.length]);

  const practiceHighlightId =
    practiceStaffNotes.length > 0 ? practiceStaffNotes[practiceStaffNotes.length - 1]!.id : null;

  const celebratePlaybackLabel =
    celebratePlayback.currentPlayingIndex != null && staffPlaybackNotes[celebratePlayback.currentPlayingIndex]
      ? `${staffPlaybackNotes[celebratePlayback.currentPlayingIndex]!.name}${staffPlaybackNotes[celebratePlayback.currentPlayingIndex]!.octave}`
      : '—';

  const celebrateHighlightId =
    celebratePlayback.currentPlayingIndex != null
      ? staffPlaybackNotes[celebratePlayback.currentPlayingIndex]?.id ?? null
      : null;

  const isCorrect = useMemo(() => {
    if (session.status === 'correct') return true;
    if (session.status === 'wrong') return false;
    return null;
  }, [session.status]);

  const statusMessage = useMemo(() => {
    if (session.micError) return session.micError;
    if (session.autoMode) return 'Auto play — follow the highlight';
    if (Platform.OS === 'web') return 'Practice mode needs a native build with the microphone module.';
    switch (session.status) {
      case 'idle':
        return 'Play the highlighted note';
      case 'listening':
        return 'Listening… play the blue key on your piano';
      case 'correct':
        return 'Correct!';
      case 'wrong':
        return 'Try again — listen for the blue note';
      case 'complete':
        return 'You finished the melody';
      default:
        return '';
    }
  }, [session.status, session.micError, session.autoMode]);

  const noteCounter =
    session.currentIndex >= session.melody.length
      ? `${session.melody.length} / ${session.melody.length}`
      : `${session.currentIndex + 1} / ${session.melody.length}`;

  const handleBack = useCallback(() => {
    session.stopAutoPlay();
    if (Platform.OS !== 'web') {
      void lockOrientation('portrait');
    }
    onBack();
  }, [onBack, session]);

  const handleRestart = useCallback(() => {
    session.stopAutoPlay();
    session.restart();
  }, [session]);

  const sheetW = sheetLayout.w > 0 ? sheetLayout.w : Math.max(200, Math.round(width * 0.4) - 24);
  const sheetH =
    sheetLayout.h > 0 ? sheetLayout.h : Math.max(120, height - insets.top - insets.bottom - HEADER_H - BOTTOM_BAR_H - 32);

  if (session.status === 'complete') {
    const celebrateW = Math.min(520, width - 32);
    const staffCelebrateH = Math.min(200, Math.round(height * 0.22));
    return (
      <View style={[styles.root, { width, height }]}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.celebrateCard}>
            <Text style={styles.celebrateTitle}>Great job</Text>
            <Text style={styles.celebrateScore}>
              {session.score.correct} / {session.score.total} correct
            </Text>
            <Text style={styles.celebrateStreak}>Streak: {session.streak}</Text>
            <Text style={styles.celebrateHint}>Hear the melody you practiced</Text>
            <View style={[styles.celebrateStaff, { maxWidth: celebrateW }]}>
              <SheetMusicView
                notes={staffPlaybackNotes}
                isListening={celebratePlayback.playbackState === 'playing'}
                isModelLoaded={true}
                width={celebrateW - 4}
                height={staffCelebrateH}
                highlightNoteId={celebrateHighlightId}
              />
            </View>
            <View style={[styles.celebratePlayback, { maxWidth: celebrateW }]}>
              <PlaybackBar
                state={celebratePlayback.playbackState}
                progress={celebratePlayback.progress}
                currentNoteLabel={celebratePlaybackLabel}
                totalNotes={staffPlaybackNotes.length}
                currentIndex={celebratePlayback.currentPlayingIndex}
                onPlay={celebratePlayback.play}
                onPause={celebratePlayback.pause}
                onStop={celebratePlayback.stop}
              />
            </View>
            <Pressable
              onPress={handleRestart}
              disabled={!!session.micError}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Practice again"
            >
              <Text style={styles.primaryBtnText}>Practice again</Text>
            </Pressable>
            {Platform.OS !== 'web' ? (
              <Pressable
                onPress={() => void shareSessionMidi(staffPlaybackNotes)}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Export practice melody as MIDI"
              >
                <Text style={styles.secondaryBtnText}>Export MIDI</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={handleBack} style={styles.secondaryBtn} accessibilityRole="button">
              <Text style={styles.secondaryBtnText}>Back to home</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { width, height }]}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={[styles.header, { minHeight: HEADER_H, paddingTop: Math.min(insets.top, 8) }]}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && styles.backPressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backGlyph}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {practiceTitle}
          </Text>
          <View style={styles.headerControls}>
            <Pressable
              onPress={() => {
                if (session.autoMode) session.stopAutoPlay();
                else void session.startAutoPlay();
              }}
              disabled={!!session.micError}
              style={({ pressed }) => [
                styles.headerPill,
                session.autoMode ? styles.headerPillAccent : styles.headerPillGhost,
                pressed && styles.headerPillPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={session.autoMode ? 'Stop auto play' : 'Start auto play'}
            >
              <Text style={[styles.headerPillText, session.autoMode && styles.headerPillTextOnAccent]}>
                {session.autoMode ? 'AUTO ■' : 'AUTO ▶'}
              </Text>
            </Pressable>
            <Pressable
              onPress={session.toggleSound}
              style={({ pressed }) => [styles.soundBtn, pressed && styles.soundBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel={session.soundEnabled ? 'Mute sound' : 'Enable sound'}
            >
              <SpeakerIcon muted={!session.soundEnabled} />
            </Pressable>
            <Pressable
              onPress={handleRestart}
              style={({ pressed }) => [styles.headerPill, styles.headerPillGhost, pressed && styles.headerPillPressed]}
              accessibilityRole="button"
              accessibilityLabel="Restart practice"
            >
              <Text style={styles.headerPillText}>↺ Restart</Text>
            </Pressable>
          </View>
        </View>

         {session.micError ? (
           <View style={styles.errorBanner}>
             <Text style={styles.errorText}>{session.micError}</Text>
           </View>
         ) : null}

         {Platform.OS === 'web' && (
           <View style={styles.webBanner}>
             <Text style={styles.webBannerText}>
               Practice with microphone requires a native iOS/Android build. On web you can use Auto-play and tap the keyboard for demo sounds.
             </Text>
           </View>
         )}

         <View style={styles.splitRow}>
          <View style={styles.sheetColumn} onLayout={onSheetLayout}>
            <View style={styles.sheetCard}>
               <SheetMusicView
                 notes={practiceStaffNotes}
                 isListening={session.status === 'listening' && !session.autoMode}
                 isModelLoaded={true}
                 width={sheetW}
                 height={Math.max(80, sheetH - 20)}
                 highlightNoteId={practiceHighlightId}
               />
            </View>
          </View>
          <View style={styles.keyboardColumn} onLayout={onKeyboardPanelLayout}>
            {keyboardLayout.w > 0 && keyboardLayout.h > 0 ? (
               <PianoKeyboard
                 expectedMidi={session.expectedMidi}
                 detectedMidi={session.detectedMidi}
                 isCorrect={isCorrect}
                 onKeyPress={handleKeyPress}
                 width={keyboardLayout.w}
                 height={keyboardLayout.h}
                 octaveStart={3}
                 octaveCount={3}
               />
            ) : (
              <View style={styles.keyboardPlaceholder} />
            )}
          </View>
        </View>

        <View style={[styles.bottomBar, { minHeight: BOTTOM_BAR_H }]}>
          <View style={styles.bottomRow}>
            <View style={styles.bottomLeft}>
              {session.status === 'listening' && session.isMicListening && !session.autoMode ? (
                <ActivityIndicator size="small" color={practiceTheme.primary} style={styles.micSpinner} />
              ) : null}
              <View style={styles.pill}>
                <Text style={styles.pillText}>{statusPillLabel(session.status, session.autoMode)}</Text>
              </View>
            </View>
            <Text style={styles.counterText}>Note {noteCounter}</Text>
            <View style={styles.dots}>
              {session.melody.map((n, i) => (
                <View
                  key={`dot-${i}-${n.midi}`}
                  style={[
                    styles.dot,
                    i < session.currentIndex && styles.dotDone,
                    i === session.currentIndex && styles.dotCurrent,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.streakText} numberOfLines={1}>
              🔥 {session.streak}
            </Text>
          </View>
          <Text style={styles.hintLine} numberOfLines={2}>
            {statusMessage}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: practiceTheme.bg,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_SUBTLE,
  },
  backBtn: {
    width: practiceTheme.minTouch,
    height: practiceTheme.minTouch,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: practiceTheme.radiusCard,
  },
  backPressed: {
    opacity: 0.75,
  },
  backGlyph: {
    color: practiceTheme.text,
    fontSize: 22,
    fontWeight: '600',
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 6,
    color: practiceTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  headerPill: {
    height: PILL_H,
    paddingHorizontal: 12,
    borderRadius: practiceTheme.radiusPill,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
  },
  headerPillGhost: {
    backgroundColor: 'transparent',
  },
  headerPillAccent: {
    backgroundColor: practiceTheme.primary,
    borderColor: practiceTheme.primary,
  },
  headerPillPressed: {
    opacity: 0.88,
  },
  headerPillText: {
    color: practiceTheme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  headerPillTextOnAccent: {
    color: practiceTheme.bg,
  },
  soundBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: practiceTheme.radiusPill,
    borderWidth: 1,
    borderColor: BORDER_SUBTLE,
  },
  soundBtnPressed: {
    opacity: 0.85,
  },
  errorBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 10,
    borderRadius: practiceTheme.radiusCard,
    backgroundColor: 'rgba(255,123,156,0.15)',
    borderWidth: 1,
    borderColor: practiceTheme.border,
  },
  errorText: {
    color: practiceTheme.danger,
    fontSize: 13,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  sheetColumn: {
    flex: 0.4,
    minWidth: 0,
    paddingLeft: 10,
    paddingVertical: 8,
    paddingRight: 6,
  },
  sheetCard: {
    flex: 1,
    padding: 8,
    borderRadius: practiceTheme.radiusCard,
    backgroundColor: practiceTheme.surface,
    borderWidth: 1,
    borderColor: practiceTheme.border,
    overflow: 'hidden',
    minHeight: 0,
  },
  keyboardColumn: {
    flex: 0.6,
    minWidth: 0,
    paddingRight: 10,
    paddingVertical: 8,
    paddingLeft: 4,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  keyboardPlaceholder: {
    flex: 1,
  },
  bottomBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: practiceTheme.border,
    backgroundColor: 'rgba(7,17,31,0.96)',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  hintLine: {
    marginTop: 4,
    color: practiceTheme.muted,
    fontSize: 11,
  },
  micSpinner: {
    marginRight: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: practiceTheme.radiusPill,
    backgroundColor: 'rgba(58,160,255,0.18)',
    borderWidth: 1,
    borderColor: practiceTheme.border,
  },
  pillText: {
    color: practiceTheme.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  counterText: {
    color: practiceTheme.muted,
    fontSize: 13,
    fontWeight: '600',
    marginHorizontal: 4,
  },
  streakText: {
    color: practiceTheme.muted,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 0,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    flexWrap: 'nowrap',
    minWidth: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(169,183,214,0.35)',
  },
  dotDone: {
    backgroundColor: practiceTheme.success,
  },
  dotCurrent: {
    backgroundColor: practiceTheme.primary,
    transform: [{ scale: 1.2 }],
  },
  celebrateCard: {
    flex: 1,
    margin: 20,
    padding: 24,
    borderRadius: practiceTheme.radiusCard,
    backgroundColor: practiceTheme.surface,
    borderWidth: 1,
    borderColor: practiceTheme.border,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 520,
    width: '100%',
  },
  celebrateTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: practiceTheme.text,
    marginBottom: 10,
  },
  celebrateScore: {
    fontSize: 17,
    color: practiceTheme.muted,
    marginBottom: 6,
  },
  celebrateStreak: {
    fontSize: 15,
    color: practiceTheme.success,
    marginBottom: 10,
    fontWeight: '600',
  },
  celebrateHint: {
    fontSize: 13,
    color: practiceTheme.muted,
    marginBottom: 10,
    textAlign: 'center',
  },
  celebrateStaff: {
    width: '100%',
    marginBottom: 8,
    borderRadius: practiceTheme.radiusCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: practiceTheme.border,
  },
  celebratePlayback: {
    width: '100%',
    marginBottom: 16,
    borderRadius: practiceTheme.radiusCard,
    overflow: 'hidden',
  },
  primaryBtn: {
    minHeight: practiceTheme.minTouch,
    paddingHorizontal: 28,
    borderRadius: practiceTheme.radiusCard,
    backgroundColor: practiceTheme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    minWidth: 200,
  },
  primaryBtnPressed: {
    opacity: 0.9,
  },
  primaryBtnText: {
    color: practiceTheme.bg,
    fontSize: 16,
    fontWeight: '700',
  },
   secondaryBtn: {
     minHeight: practiceTheme.minTouch,
     paddingHorizontal: 20,
     justifyContent: 'center',
     alignItems: 'center',
     marginBottom: 6,
   },
   secondaryBtnPressed: { opacity: 0.85 },
   secondaryBtnText: {
     color: practiceTheme.muted,
     fontSize: 15,
     fontWeight: '600',
   },
   webBanner: {
     marginHorizontal: 12,
     marginBottom: 6,
     padding: 10,
     borderRadius: practiceTheme.radiusCard,
     backgroundColor: 'rgba(58,160,255,0.15)',
     borderWidth: 1,
     borderColor: practiceTheme.border,
   },
   webBannerText: {
     color: practiceTheme.primary,
     fontSize: 13,
     textAlign: 'center',
   },
 });
