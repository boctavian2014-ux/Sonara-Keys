import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, layout, radius, shadows } from '../../theme';

type Props = {
  isListening: boolean;
  /** Mic / native session is starting; keep idle visuals but show a spinner. */
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

const SIZE = layout.heroButtonSize;
const R = SIZE / 2;

/**
 * Central CTA: idle = cool gradient + mic glyph; listening = warm gradient + stop square + pulsing rings.
 *
 * Reanimated upgrade: replace `Animated` rings with `useSharedValue` + `withRepeat(withTiming)`,
 * and use `interpolate` on `rotate` for a slow orbit accent if desired.
 */
export function ListenHeroButton({ isListening, busy = false, disabled, onPress }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isListening) {
      pulse.setValue(0);
      pulseB.setValue(0);
      return;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(pulseB, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseB, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [isListening, pulse, pulseB]);

  const ring1Opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.42],
  });
  const ring1Scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const ring2Opacity = pulseB.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.28],
  });
  const ring2Scale = pulseB.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.2],
  });

  const ringSize = SIZE + layout.ringInset * 2;
  const ringSize2 = SIZE + layout.ringInset * 2 + 22;

  return (
    <View style={styles.wrap}>
      {isListening ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                width: ringSize2,
                height: ringSize2,
                borderRadius: ringSize2 / 2,
                opacity: ring2Opacity,
                transform: [{ scale: ring2Scale }],
                borderColor: colors.listenActiveRing,
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                width: ringSize,
                height: ringSize,
                borderRadius: ringSize / 2,
                opacity: ring1Opacity,
                transform: [{ scale: ring1Scale }],
                borderColor: colors.accentElectric,
              },
            ]}
          />
        </>
      ) : null}

      <Pressable
        onPress={disabled || busy ? undefined : onPress}
        disabled={disabled || busy}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        android_disableSound
        style={({ pressed }) => [
          styles.hit,
          isListening ? shadows.heroActive : shadows.hero,
          pressed && !disabled && styles.hitPressed,
          disabled && styles.hitDisabled,
          busy && !isListening && styles.hitBusy,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          isListening ? 'Stop listening' : busy ? 'Please wait' : 'Start listening'
        }
      >
        <LinearGradient
          colors={
            isListening
              ? ['#9D174D', '#E11D48', '#C2410C']
              : [colors.accentIndigo, colors.accentBlue, colors.accentTeal]
          }
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.gradient}
        >
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient
              colors={['rgba(255,255,255,0.22)', 'transparent', 'rgba(0,0,0,0.18)']}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={styles.innerDisc}>
            {busy ? (
              <ActivityIndicator size="large" color={colors.textPrimary} />
            ) : isListening ? (
              <View style={styles.stopIcon} />
            ) : (
              <Svg width={56} height={56} viewBox="0 0 24 24" accessibilityElementsHidden>
                <Path
                  d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"
                  fill={colors.textPrimary}
                />
              </Svg>
            )}
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE + 72,
    height: SIZE + 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  hit: {
    width: SIZE,
    height: SIZE,
    borderRadius: R,
    overflow: 'hidden',
  },
  hitPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.95,
  },
  hitDisabled: {
    opacity: 0.45,
  },
  hitBusy: {
    opacity: 0.88,
  },
  gradient: {
    flex: 1,
    borderRadius: R,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDisc: {
    width: SIZE - 28,
    height: SIZE - 28,
    borderRadius: (SIZE - 28) / 2,
    backgroundColor: 'rgba(10,14,26,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.textPrimary,
  },
});
