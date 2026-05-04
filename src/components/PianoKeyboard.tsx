import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { practiceTheme } from '../theme/practiceTheme';

function whiteMidisForRange(octaveStart: number, octaveCount: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < octaveCount; k++) {
    const oct = octaveStart + k;
    const base = (oct + 1) * 12;
    out.push(base, base + 2, base + 4, base + 5, base + 7, base + 9, base + 11);
  }
  return out;
}

function blackMidisForRange(octaveStart: number, octaveCount: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < octaveCount; k++) {
    const oct = octaveStart + k;
    const base = (oct + 1) * 12;
    out.push(base + 1, base + 3, base + 6, base + 8, base + 10);
  }
  return out;
}

/** Left offset in white-key widths from keyboard origin to black key center (fractional). */
function blackFracFromWhiteIndex(whites: readonly number[], blackMidi: number): number | null {
  const i = whites.findIndex((w) => w === blackMidi - 1);
  if (i < 0) return null;
  return i + 0.65;
}

export type PianoKeyboardProps = {
  expectedMidi: number | null;
  detectedMidi: number | null;
  isCorrect: boolean | null;
  onKeyPress?: (midi: number) => void;
  width: number;
  height: number;
  octaveStart?: number;
  octaveCount?: number;
};

function whiteKeyFill(
  midi: number,
  expectedMidi: number | null,
  detectedMidi: number | null,
  isCorrect: boolean | null,
  pressedMidi: number | null,
): string {
  if (detectedMidi === midi && isCorrect === true) return practiceTheme.success;
  if (detectedMidi === midi && isCorrect === false) return practiceTheme.danger;
  if (midi === expectedMidi) return practiceTheme.primary;
  if (pressedMidi === midi) return '#D0D4E0';
  return practiceTheme.whiteKey;
}

function blackKeyFill(
  midi: number,
  expectedMidi: number | null,
  detectedMidi: number | null,
  isCorrect: boolean | null,
  pressedMidi: number | null,
): string {
  if (detectedMidi === midi && isCorrect === true) return '#16A34A';
  if (detectedMidi === midi && isCorrect === false) return '#BE123C';
  if (midi === expectedMidi) return '#1D4ED8';
  if (pressedMidi === midi) return '#2A3145';
  return practiceTheme.blackKey;
}

export function PianoKeyboard({
  expectedMidi,
  detectedMidi,
  isCorrect,
  onKeyPress,
  width,
  height,
  octaveStart = 3,
  octaveCount = 3,
}: PianoKeyboardProps) {
  const whites = useMemo(() => whiteMidisForRange(octaveStart, octaveCount), [octaveStart, octaveCount]);
  const blacks = useMemo(() => blackMidisForRange(octaveStart, octaveCount), [octaveStart, octaveCount]);

  const whiteW = width / whites.length;
  const keyHeight = Math.max(1, height);
  const blackW = whiteW * 0.58;
  const blackH = keyHeight * 0.65;

  const [pressedMidi, setPressedMidi] = useState<number | null>(null);

  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCorrect === false) {
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
      ]).start();
    }
  }, [isCorrect, shake]);

  const shakeStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: shake.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [-6, 0, 6],
          }),
        },
      ],
    }),
    [shake],
  );

  const blackLayouts = useMemo(() => {
    return blacks
      .map((m) => {
        const frac = blackFracFromWhiteIndex(whites, m);
        if (frac == null) return null;
        const left = frac * whiteW - blackW / 2;
        return { m, left };
      })
      .filter((x): x is { m: number; left: number } => x != null);
  }, [blacks, whites, whiteW, blackW]);

  return (
    <Animated.View style={[styles.root, { width, height: keyHeight }, isCorrect === false ? shakeStyle : undefined]}>
      <Svg width={width} height={keyHeight}>
        {whites.map((m, i) => {
          const x = i * whiteW;
          return (
            <Rect
              key={m}
              x={x + 0.5}
              y={0}
              width={whiteW - 1}
              height={keyHeight}
              rx={6}
              ry={6}
              fill={whiteKeyFill(m, expectedMidi, detectedMidi, isCorrect, pressedMidi)}
              stroke="rgba(15,23,42,0.18)"
              strokeWidth={1}
            />
          );
        })}
        {blackLayouts.map(({ m, left }) => (
          <Rect
            key={m}
            x={left}
            y={0}
            width={blackW}
            height={blackH}
            rx={3}
            ry={3}
            fill={blackKeyFill(m, expectedMidi, detectedMidi, isCorrect, pressedMidi)}
          />
        ))}
      </Svg>

      <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
        <View style={[styles.whiteRow, { height: keyHeight }]}>
          {whites.map((m) => (
            <Pressable
              key={`p-${m}`}
              style={({ pressed }) => [
                styles.whiteHit,
                { flex: 1, minWidth: Math.min(whiteW, practiceTheme.minTouch) },
                pressed && styles.hitPressed,
              ]}
              onPressIn={() => setPressedMidi(m)}
              onPressOut={() => setPressedMidi(null)}
              onPress={() => onKeyPress?.(m)}
              accessibilityRole="button"
              accessibilityLabel={`Piano key midi ${m}`}
            />
          ))}
        </View>
        {blackLayouts.map(({ m, left }) => (
          <Pressable
            key={`pb-${m}`}
            style={[
              styles.blackHit,
              {
                left,
                width: Math.max(blackW, 36),
                height: Math.max(blackH, practiceTheme.minTouch * 0.55),
              },
            ]}
            onPressIn={() => setPressedMidi(m)}
            onPressOut={() => setPressedMidi(null)}
            onPress={() => onKeyPress?.(m)}
            accessibilityRole="button"
            accessibilityLabel={`Piano black key midi ${m}`}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  overlay: {
    flexDirection: 'row',
  },
  whiteRow: {
    flexDirection: 'row',
    width: '100%',
  },
  whiteHit: {
    minHeight: 44,
  },
  blackHit: {
    position: 'absolute',
    top: 0,
    minWidth: 36,
  },
  hitPressed: {
    opacity: 0.92,
  },
});
