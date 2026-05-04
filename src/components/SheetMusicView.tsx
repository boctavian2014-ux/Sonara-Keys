import { useEffect, useMemo, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Text as SvgText } from 'react-native-svg';

import type { DetectedNote } from '../../types/notes';
import {
  CLEF_W,
  MIDDLE_LINE_Y,
  NOTE_W,
  STAFF_LINE_YS,
  accidentalSymbol,
  ledgerYsForNote,
  midiToStaffY,
} from '../audio/staffGeometry';

export type SheetMusicViewProps = {
  notes: DetectedNote[];
  isListening: boolean;
  /** After mic stops: server / Basic Pitch / YIN is still running. */
  isTranscribing?: boolean;
  isModelLoaded: boolean;
  width: number;
  height?: number;
  /** When set, this note gets the “current” glow instead of max startTime. */
  highlightNoteId?: string | null;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function SheetMusicView({
  notes,
  isListening,
  isTranscribing = false,
  isModelLoaded,
  width,
  height = 120,
  highlightNoteId = null,
}: SheetMusicViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sorted = useMemo(() => [...notes].sort((a, b) => a.startTime - b.startTime), [notes]);

  const latestId = useMemo(() => {
    if (sorted.length === 0) return null;
    let best = sorted[0]!;
    for (const n of sorted) {
      if (n.startTime >= best.startTime) best = n;
    }
    return best.id;
  }, [sorted]);

  const glowId = highlightNoteId ?? latestId;

  const contentW = useMemo(() => {
    return Math.max(width, CLEF_W + 24 + Math.max(sorted.length, 1) * NOTE_W + 32);
  }, [width, sorted.length]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [sorted.length, contentW]);

  const svgH = Math.min(height, 112);

  const showBlockingModelOverlay = !isModelLoaded && !isListening;
  const waitingForNotes = isListening && sorted.length === 0;
  const transcribingHint = isTranscribing && sorted.length === 0;
  const idleHint = !isListening && !isTranscribing && sorted.length === 0 && isModelLoaded;

  return (
    <View style={[styles.wrap, { width, height }]}>
      {showBlockingModelOverlay ? (
        <View style={styles.overlayMsg}>
          <Animated.View style={{ opacity: pulse }}>
            <Text style={styles.msgText}>Loading AI model…</Text>
          </Animated.View>
        </View>
      ) : null}

      {idleHint ? (
        <View style={styles.overlayMsg}>
          <Animated.View style={[styles.micGlyph, { opacity: pulse }]}>
            <Svg width={40} height={40} viewBox="0 0 24 24">
              <Path
                d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z"
                fill="rgba(255,255,255,0.85)"
              />
            </Svg>
          </Animated.View>
          <Text style={styles.msgText}>Start listening to see notes</Text>
        </View>
      ) : null}

      {waitingForNotes ? (
        <View style={styles.overlayMsg}>
          <Animated.View style={{ opacity: pulse }}>
            <Text style={styles.msgText}>
              {isModelLoaded ? 'Listening…' : 'Listening… (loading model)'}
            </Text>
          </Animated.View>
        </View>
      ) : null}

      {transcribingHint ? (
        <View style={styles.overlayMsg}>
          <Animated.View style={{ opacity: pulse }}>
            <Text style={styles.msgText}>Transcriere…</Text>
          </Animated.View>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ minWidth: contentW, alignItems: 'center' }}
      >
        <Svg width={contentW} height={svgH}>
          <G opacity={0.92}>
            {STAFF_LINE_YS.map((y, i) => (
              <Line
                key={`ln-${i}`}
                x1={CLEF_W + 6}
                x2={contentW - 12}
                y1={y}
                y2={y}
                stroke="rgba(169,183,214,0.55)"
                strokeWidth={1.2}
              />
            ))}
          </G>

          {sorted.map((n, j) => {
            const cx = CLEF_W + 20 + j * NOTE_W;
            const cy = midiToStaffY(n.midi);
            const stemUp = cy > MIDDLE_LINE_Y;
            const stemLen = 30;
            const acc = accidentalSymbol(n.name);
            const isCurrent = n.id === glowId;

            const ledgers = ledgerYsForNote(cy);

            return (
              <G key={n.id}>
                {ledgers.map((ly, k) => (
                  <Line
                    key={`lg-${n.id}-${k}`}
                    x1={cx - 14}
                    x2={cx + 14}
                    y1={ly}
                    y2={ly}
                    stroke="rgba(169,183,214,0.65)"
                    strokeWidth={1}
                  />
                ))}
                {isCurrent ? (
                  <AnimatedCircle
                    cx={cx}
                    cy={cy}
                    r={14}
                    fill="#3AA0FF"
                    opacity={pulse.interpolate({ inputRange: [0.4, 1], outputRange: [0.22, 0.38] })}
                  />
                ) : null}
                <G transform={`rotate(-15 ${cx} ${cy})`}>
                  <Ellipse cx={cx} cy={cy} rx={7} ry={5} fill="#FFFFFF" stroke="rgba(15,23,42,0.25)" strokeWidth={0.8} />
                </G>
                {acc ? (
                  <SvgText x={cx - 14} y={cy + 4} fontSize={10} fill="rgba(255,255,255,0.82)">
                    {acc}
                  </SvgText>
                ) : null}
                {stemUp ? (
                  <Line
                    x1={cx + 4}
                    y1={cy - 5}
                    x2={cx + 4}
                    y2={cy - 5 - stemLen}
                    stroke="#FFFFFF"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                ) : (
                  <Line
                    x1={cx - 4}
                    y1={cy + 5}
                    x2={cx - 4}
                    y2={cy + 5 + stemLen}
                    stroke="#FFFFFF"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                )}
                <SvgText x={cx} y={svgH - 6} fontSize={10} fill="rgba(169,183,214,0.9)" textAnchor="middle">
                  {`${n.name}${n.octave}`}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: 'rgba(7,17,31,0.92)',
    justifyContent: 'center',
  },
  overlayMsg: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    paddingHorizontal: 12,
  },
  micGlyph: {
    marginBottom: 8,
  },
  msgText: {
    color: 'rgba(248,250,252,0.88)',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
