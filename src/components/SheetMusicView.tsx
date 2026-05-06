import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, SvgXml, Text as SvgText } from 'react-native-svg';

import type { DetectedNote } from '../../types/notes';
import type { NoteValue, ScoreAnalysis } from '../../types/score';
import {
  CLEF_W,
  MIDDLE_LINE_Y,
  NOTE_W,
  STAFF_LINE_YS,
  accidentalSymbol,
  ledgerYsForNote,
  midiToStaffY,
} from '../audio/staffGeometry';
import { renderScoreSvgRemote } from '../audio/renderScoreSvgRemote';

export type SheetMusicViewProps = {
  notes: DetectedNote[];
  /** Optional analyzed score (rhythm, meter, key, chords, LH/RH). When present and not listening, renders grand staff. */
  analysis?: ScoreAnalysis | null;
  isListening: boolean;
  /** After mic stops: server / Basic Pitch / YIN is still running. */
  isTranscribing?: boolean;
  /** 0–100 while `isTranscribing` (from useNoteDetection). */
  transcriptionProgress?: number | null;
  isModelLoaded: boolean;
  width: number;
  height?: number;
  /** When set, this note gets the “current” glow instead of max startTime. */
  highlightNoteId?: string | null;
  /** Stack multiple treble systems when the melody needs more horizontal space. */
  multilineStaff?: boolean;
  /** When true (default), cap single-system SVG height at 112 for compact cards. */
  clampSvgHeight?: boolean;
  /** Scroll to show the latest notes when the list grows. */
  autoScrollToEnd?: boolean;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SYSTEM_GAP = 10;

const GRAND_GAP = 18;
const TREBLE_LINES = STAFF_LINE_YS;
const BASS_LINES = TREBLE_LINES.map((y) => y + 86);

function noteHeadFill(value: NoteValue): { fill: string; stroke: string } {
  if (value === 'whole' || value === 'half' || value === 'half_dotted') {
    return { fill: 'rgba(255,255,255,0.08)', stroke: '#FFFFFF' };
  }
  return { fill: '#FFFFFF', stroke: 'rgba(15,23,42,0.25)' };
}

function durationGlyph(value: NoteValue): string {
  if (value === 'whole') return '𝅝';
  if (value === 'half') return '𝅗𝅥';
  if (value === 'half_dotted') return '𝅗𝅥.';
  if (value === 'quarter') return '𝅘𝅥';
  if (value === 'quarter_dotted') return '𝅘𝅥.';
  if (value === 'eighth') return '𝅘𝅥𝅮';
  if (value === 'eighth_dotted') return '𝅘𝅥𝅮.';
  if (value === 'sixteenth') return '𝅘𝅥𝅯';
  return '𝅘𝅥𝅰';
}

function accidentalStack(kind: 'sharp' | 'flat', count: number): string[] {
  const sym = kind === 'sharp' ? '♯' : '♭';
  return Array.from({ length: Math.max(0, count) }, () => sym);
}

function chunkNotesByWidth(sorted: DetectedNote[], rowWidth: number): DetectedNote[][] {
  const usable = Math.max(NOTE_W * 2, rowWidth - CLEF_W - 40);
  const notesPerRow = Math.max(1, Math.floor(usable / NOTE_W));
  if (sorted.length === 0) return [[]];
  const chunks: DetectedNote[][] = [];
  for (let i = 0; i < sorted.length; i += notesPerRow) {
    chunks.push(sorted.slice(i, i + notesPerRow));
  }
  return chunks;
}

function TranscribeOverlay({
  pulse,
  progress,
}: {
  pulse: Animated.Value;
  progress: number | null;
}) {
  return (
    <View style={styles.transcribeOverlay} pointerEvents="auto">
      <Animated.View
        style={[
          styles.transcribeTopBar,
          { opacity: pulse.interpolate({ inputRange: [0.4, 1], outputRange: [0.55, 1] }) },
        ]}
      />
      <View style={styles.transcribeCard}>
        <ActivityIndicator size="large" color="rgba(45,212,191,0.95)" />
        <Text style={styles.transcribeTitle}>Se construiește portativul</Text>
        <Text style={styles.transcribePct}>
          {progress != null && Number.isFinite(progress) ? `${Math.round(progress)}%` : 'Pornire…'}
        </Text>
        <Text style={styles.transcribeSub}>
          Analizăm înregistrarea (server PC, AI local sau ambele). Poate dura 1–2 minute — nu închide
          aplicația.
        </Text>
      </View>
    </View>
  );
}

function GrandStaffSvg({
  analysis,
  contentW,
  svgH,
  glowId,
  pulse,
}: {
  analysis: ScoreAnalysis;
  contentW: number;
  svgH: number;
  glowId: string | null;
  pulse: Animated.Value;
}) {
  const notes = analysis.notes;
  const barLenBeats =
    analysis.timeSignature.beatsPerBar * (analysis.timeSignature.beatUnit === 8 ? 0.5 : 1);

  const scaleX = 34; // px per beat (heuristic)
  const originX = CLEF_W + 74;

  const accs = accidentalStack(analysis.keySignature.accidentals.kind, analysis.keySignature.accidentals.count);

  const beatToX = (beats: number) => originX + beats * scaleX;

  // Barlines
  const barlines = analysis.measures.map((m) => m.startBeats).filter((b) => b > 0);

  // Group chord-like stacks by onsetGroupId per staff.
  const rhGroups = new Map<string, typeof notes>();
  const lhGroups = new Map<string, typeof notes>();
  for (const n of notes) {
    const groups = n.hand === 'RH' ? rhGroups : lhGroups;
    const arr = groups.get(n.onsetGroupId);
    if (arr) arr.push(n);
    else groups.set(n.onsetGroupId, [n]);
  }

  const drawGroups = (groups: Map<string, typeof notes>, yOffset: number, middleLineY: number) => {
    const out: React.ReactNode[] = [];
    for (const [, nsRaw] of groups) {
      const ns = nsRaw.slice().sort((a, b) => a.midi - b.midi);
      const x = beatToX(ns[0]!.qOnsetBeats);
      for (const n of ns) {
        const cy = midiToStaffY(n.midi) + yOffset;
        const stemUp = cy > middleLineY;
        const stemLen = 30;
        const isCurrent = n.id === glowId;
        const { fill, stroke } = noteHeadFill(n.value);

        const ledgers = ledgerYsForNote(cy - yOffset).map((ly) => ly + yOffset);

        out.push(
          <G key={`${n.id}-g`}>
            {ledgers.map((ly, k) => (
              <Line
                key={`lg-${n.id}-${k}`}
                x1={x - 14}
                x2={x + 14}
                y1={ly}
                y2={ly}
                stroke="rgba(186,198,230,0.82)"
                strokeWidth={1.15}
              />
            ))}
            {isCurrent ? (
              <AnimatedCircle
                cx={x}
                cy={cy}
                r={14}
                fill="#3AA0FF"
                opacity={pulse.interpolate({ inputRange: [0.4, 1], outputRange: [0.18, 0.32] })}
              />
            ) : null}
            <G transform={`rotate(-15 ${x} ${cy})`}>
              <Ellipse cx={x} cy={cy} rx={7.5} ry={5.2} fill={fill} stroke={stroke} strokeWidth={1} />
            </G>
            {stemUp ? (
              <Line
                x1={x + 4}
                y1={cy - 5}
                x2={x + 4}
                y2={cy - 5 - stemLen}
                stroke="#FFFFFF"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            ) : (
              <Line
                x1={x - 4}
                y1={cy + 5}
                x2={x - 4}
                y2={cy + 5 + stemLen}
                stroke="#FFFFFF"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            )}
            <SvgText
              x={x}
              y={cy + 22}
              fontSize={10}
              fill="rgba(169,183,214,0.9)"
              textAnchor="middle"
            >
              {durationGlyph(n.value)}
            </SvgText>
          </G>,
        );
      }
    }
    return out;
  };

  return (
    <Svg width={contentW} height={svgH}>
      <G opacity={0.92}>
        {TREBLE_LINES.map((y, i) => (
          <Line
            key={`tln-${i}`}
            x1={CLEF_W + 6}
            x2={contentW - 12}
            y1={y}
            y2={y}
            stroke="rgba(186,198,230,0.78)"
            strokeWidth={1.35}
          />
        ))}
        {BASS_LINES.map((y, i) => (
          <Line
            key={`bln-${i}`}
            x1={CLEF_W + 6}
            x2={contentW - 12}
            y1={y}
            y2={y}
            stroke="rgba(186,198,230,0.78)"
            strokeWidth={1.35}
          />
        ))}
      </G>

      {/* Clefs (unicode as a pragmatic start) */}
      <SvgText x={CLEF_W - 22} y={58} fontSize={34} fill="rgba(255,255,255,0.92)">
        𝄞
      </SvgText>
      <SvgText x={CLEF_W - 22} y={58 + 86} fontSize={34} fill="rgba(255,255,255,0.92)">
        𝄢
      </SvgText>

      {/* Key signature (simple stack) */}
      {accs.map((sym, i) => (
        <SvgText
          key={`ks-${i}`}
          x={CLEF_W + 10 + i * 10}
          y={48}
          fontSize={16}
          fill="rgba(255,255,255,0.85)"
        >
          {sym}
        </SvgText>
      ))}
      {accs.map((sym, i) => (
        <SvgText
          key={`ksb-${i}`}
          x={CLEF_W + 10 + i * 10}
          y={48 + 86}
          fontSize={16}
          fill="rgba(255,255,255,0.85)"
        >
          {sym}
        </SvgText>
      ))}

      {/* Time signature */}
      <SvgText x={CLEF_W + 40} y={34} fontSize={16} fill="rgba(255,255,255,0.85)">
        {analysis.timeSignature.beatsPerBar}
      </SvgText>
      <SvgText x={CLEF_W + 40} y={54} fontSize={16} fill="rgba(255,255,255,0.85)">
        {analysis.timeSignature.beatUnit}
      </SvgText>
      <SvgText x={CLEF_W + 40} y={34 + 86} fontSize={16} fill="rgba(255,255,255,0.85)">
        {analysis.timeSignature.beatsPerBar}
      </SvgText>
      <SvgText x={CLEF_W + 40} y={54 + 86} fontSize={16} fill="rgba(255,255,255,0.85)">
        {analysis.timeSignature.beatUnit}
      </SvgText>

      {/* Barlines */}
      {barlines.map((b) => {
        const x = beatToX(b);
        return (
          <G key={`bar-${b}`}>
            <Line x1={x} x2={x} y1={TREBLE_LINES[0]!} y2={BASS_LINES[BASS_LINES.length - 1]!} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          </G>
        );
      })}

      {/* Notes */}
      {drawGroups(rhGroups, 0, MIDDLE_LINE_Y)}
      {drawGroups(lhGroups, 86, MIDDLE_LINE_Y + 86)}

      {/* Chord labels (top) */}
      {analysis.chords.slice(0, 24).map((c, i) => (
        <SvgText
          key={`ch-${i}`}
          x={beatToX(c.onsetBeats)}
          y={14}
          fontSize={10}
          fill="rgba(45,212,191,0.9)"
          textAnchor="middle"
        >
          {c.label}
        </SvgText>
      ))}

      {/* Key label */}
      <SvgText x={contentW - 10} y={14} fontSize={10} fill="rgba(169,183,214,0.8)" textAnchor="end">
        {`${analysis.keySignature.tonic} ${analysis.keySignature.mode}`}
      </SvgText>
    </Svg>
  );
}

function StaffSystemSvg({
  chunk,
  contentW,
  svgH,
  glowId,
  pulse,
}: {
  chunk: DetectedNote[];
  contentW: number;
  svgH: number;
  glowId: string | null;
  pulse: Animated.Value;
}) {
  return (
    <Svg width={contentW} height={svgH}>
      <G opacity={0.92}>
        {STAFF_LINE_YS.map((y, i) => (
          <Line
            key={`ln-${i}`}
            x1={CLEF_W + 6}
            x2={contentW - 12}
            y1={y}
            y2={y}
            stroke="rgba(186,198,230,0.78)"
            strokeWidth={1.35}
          />
        ))}
      </G>

      {chunk.map((n, j) => {
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
                stroke="rgba(186,198,230,0.82)"
                strokeWidth={1.15}
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
              <Ellipse
                cx={cx}
                cy={cy}
                rx={7.5}
                ry={5.2}
                fill="#FFFFFF"
                stroke="rgba(15,23,42,0.35)"
                strokeWidth={1}
              />
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
  );
}

export function SheetMusicView({
  notes,
  analysis = null,
  isListening,
  isTranscribing = false,
  transcriptionProgress = null,
  isModelLoaded,
  width,
  height = 120,
  highlightNoteId = null,
  multilineStaff = false,
  clampSvgHeight = true,
  autoScrollToEnd = true,
}: SheetMusicViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(0.4)).current;
  const [engravedSvg, setEngravedSvg] = useState<string | null>(null);
  const [engraveError, setEngraveError] = useState<string | null>(null);

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

  const chunks = useMemo(() => {
    if (!multilineStaff) {
      return [sorted];
    }
    return chunkNotesByWidth(sorted, width);
  }, [multilineStaff, sorted, width]);

  const systemH = useMemo(() => {
    if (multilineStaff) {
      return 108;
    }
    return clampSvgHeight ? Math.min(height, 112) : height;
  }, [multilineStaff, clampSvgHeight, height]);

  const contentWidths = useMemo(() => {
    return chunks.map((chunk) =>
      Math.max(width, CLEF_W + 24 + Math.max(chunk.length, 1) * NOTE_W + 32),
    );
  }, [chunks, width]);

  useEffect(() => {
    if (!autoScrollToEnd) return;
    requestAnimationFrame(() => {
      if (multilineStaff && chunks.some((c) => c.length > 0)) {
        vScrollRef.current?.scrollToEnd({ animated: true });
      } else {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    });
  }, [sorted.length, multilineStaff, chunks.length, autoScrollToEnd]);

  const showBlockingModelOverlay = !isModelLoaded && !isListening;
  const waitingForNotes = isListening && sorted.length === 0;
  const idleHint = !isListening && !isTranscribing && sorted.length === 0 && isModelLoaded;

  const overlays = (
    <>
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
    </>
  );

  const canUseGrand = analysis != null && !isListening && !isTranscribing && analysis.notes.length > 0;

  useEffect(() => {
    // Only fetch engraved SVG for the "portativ mare" expanded view (multilineStaff).
    if (!canUseGrand || !multilineStaff || analysis == null) {
      setEngravedSvg(null);
      setEngraveError(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setEngraveError(null);
    setEngravedSvg(null);
    void (async () => {
      const r = await renderScoreSvgRemote(analysis, ac.signal);
      if (cancelled) return;
      if (r.ok) {
        setEngravedSvg(r.svg);
      } else {
        setEngraveError(r.error);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [analysis, canUseGrand, multilineStaff]);

  if (canUseGrand) {
    const maxBeat =
      analysis.measures.length > 0
        ? analysis.measures[analysis.measures.length - 1]!.endBeats
        : Math.max(...analysis.notes.map((n) => n.qOnsetBeats + n.qDurBeats));
    const scaleX = 34;
    const contentW = Math.max(width, CLEF_W + 120 + maxBeat * scaleX + 24);
    const svgH = 20 + 68 + 86 + 68 + GRAND_GAP;
    const useRemote = multilineStaff && engravedSvg != null;
    return (
      <View style={[styles.wrap, { width, height }]}>
        {overlays}
        {isTranscribing ? <TranscribeOverlay pulse={pulse} progress={transcriptionProgress ?? null} /> : null}
        {useRemote ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ minWidth: contentW, alignItems: 'center' }}
            nestedScrollEnabled
          >
            <SvgXml xml={engravedSvg} width={contentW} height={svgH} />
          </ScrollView>
        ) : (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ minWidth: contentW, alignItems: 'center' }}
            nestedScrollEnabled
          >
            <GrandStaffSvg analysis={analysis} contentW={contentW} svgH={svgH} glowId={glowId} pulse={pulse} />
          </ScrollView>
        )}
        {multilineStaff && engravedSvg == null && engraveError ? (
          <View style={styles.engraveHint}>
            <Text style={styles.engraveHintText} numberOfLines={5}>
              {engraveError.includes('404') || engraveError.toLowerCase().includes('nu există post')
                ? 'Portativ mare: gravura SVG (LilyPond) nu e pe acest server — redeploy server-ts (Dockerfile cu LilyPond) sau setează EXPO_PUBLIC_SCORE_RENDER_API_URL. Mai sus e portativul vector din app.'
                : `SVG: ${engraveError}`}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (multilineStaff && sorted.length > 0) {
    return (
      <View style={[styles.wrap, { width, height }]}>
        {overlays}
        {isTranscribing ? <TranscribeOverlay pulse={pulse} progress={transcriptionProgress ?? null} /> : null}
        <ScrollView
          ref={vScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 6 }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {chunks.map((chunk, ri) => {
            if (chunk.length === 0) return null;
            const cw = contentWidths[ri] ?? width;
            const hasMoreBelow = chunks.slice(ri + 1).some((c) => c.length > 0);
            return (
              <View key={`row-${ri}`} style={{ marginBottom: hasMoreBelow ? SYSTEM_GAP : 0 }}>
                <ScrollView
                  ref={!hasMoreBelow ? scrollRef : undefined}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled
                  contentContainerStyle={{ minWidth: cw, alignItems: 'center' }}
                >
                  <StaffSystemSvg chunk={chunk} contentW={cw} svgH={systemH} glowId={glowId} pulse={pulse} />
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  const singleContentW = contentWidths[0] ?? Math.max(width, CLEF_W + 24 + Math.max(sorted.length, 1) * NOTE_W + 32);

  return (
    <View style={[styles.wrap, { width, height }]}>
      {overlays}
      {isTranscribing ? <TranscribeOverlay pulse={pulse} progress={transcriptionProgress ?? null} /> : null}

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ minWidth: singleContentW, alignItems: 'center' }}
        nestedScrollEnabled
      >
        <StaffSystemSvg
          chunk={sorted}
          contentW={singleContentW}
          svgH={systemH}
          glowId={glowId}
          pulse={pulse}
        />
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
  engraveHint: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
  },
  engraveHintText: {
    color: 'rgba(226,232,240,0.82)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  transcribeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(7,17,31,0.78)',
  },
  transcribeTopBar: {
    position: 'absolute',
    top: 10,
    left: '8%',
    right: '8%',
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(45,212,191,0.85)',
  },
  transcribeCard: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.42)',
    backgroundColor: 'rgba(15,23,42,0.94)',
    maxWidth: 320,
    gap: 12,
  },
  transcribeTitle: {
    color: 'rgba(248,250,252,0.95)',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  transcribePct: {
    color: 'rgba(45,212,191,0.95)',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  transcribeSub: {
    color: 'rgba(203,213,225,0.88)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 19,
  },
});
