import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { PlaybackState } from '../audio/useNotePlayback';
import { practiceTheme } from '../theme/practiceTheme';

export type PlaybackBarProps = {
  state: PlaybackState;
  progress: number;
  currentNoteLabel: string;
  totalNotes: number;
  currentIndex: number | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
};

const PLAY_SIZE = 52;

function PlayIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M8 5v14l11-7z" fill={color} />
    </Svg>
  );
}

function PauseIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" fill={color} />
    </Svg>
  );
}

export function PlaybackBar({
  state,
  progress,
  currentNoteLabel,
  totalNotes,
  currentIndex,
  onPlay,
  onStop,
  onPause,
}: PlaybackBarProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'playing') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 550, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  const idxLabel = useMemo(() => {
    if (totalNotes === 0) return '—';
    if (currentIndex == null) return `— / ${totalNotes}`;
    return `Note ${currentIndex + 1} / ${totalNotes}`;
  }, [currentIndex, totalNotes]);

  const showPause = state === 'playing';

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={showPause ? onPause : onPlay}
        style={({ pressed }) => [styles.playOuter, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={showPause ? 'Pause playback' : 'Play detected notes'}
      >
        <LinearGradient colors={['#3AA0FF', '#1D6DFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playGrad}>
          {showPause ? <PauseIcon color="#FFFFFF" /> : <PlayIcon color="#FFFFFF" />}
        </LinearGradient>
      </Pressable>

      <View style={styles.mid}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Animated.Text style={[styles.noteLabel, state === 'playing' && { opacity: pulse }]} numberOfLines={1}>
          {currentNoteLabel}
        </Animated.Text>
      </View>

      <View style={styles.rightCol}>
        <Text style={styles.counter}>{idxLabel}</Text>
        <Pressable onPress={onStop} style={({ pressed }) => [styles.stopPill, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Stop playback">
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17, 30, 56, 0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(151, 179, 255, 0.12)',
    gap: 12,
  },
  playOuter: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#3AA0FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  playGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  mid: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: practiceTheme.primary,
  },
  noteLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: practiceTheme.text,
  },
  rightCol: {
    alignItems: 'flex-end',
    gap: 6,
    minWidth: 72,
  },
  counter: {
    fontSize: 12,
    color: practiceTheme.muted,
    fontWeight: '600',
  },
  stopPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: practiceTheme.border,
    justifyContent: 'center',
  },
  stopText: {
    color: practiceTheme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
});
