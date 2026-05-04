import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';

import { GlassCard } from './GlassCard';

type Props = {
  visible: boolean;
  onClose: () => void;
  autoTranscribeOnStop: boolean;
  onAutoTranscribeChange: (v: boolean) => void;
  transcribeBusy: boolean;
};

export function SettingsSheet({
  visible,
  onClose,
  autoTranscribeOnStop,
  onAutoTranscribeChange,
  transcribeBusy,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close settings" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Settings</Text>
          <GlassCard style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Basic Pitch on stop</Text>
                <Text style={styles.hint}>After you stop, run ML transcription (needs network).</Text>
              </View>
              <Switch
                value={autoTranscribeOnStop}
                onValueChange={onAutoTranscribeChange}
                disabled={transcribeBusy}
                trackColor={{ false: colors.borderStrong, true: 'rgba(45,212,191,0.45)' }}
                thumbColor={autoTranscribeOnStop ? colors.accentTeal : colors.textMuted}
              />
            </View>
          </GlassCard>
          <Pressable onPress={onClose} style={styles.doneBtn} accessibilityRole="button">
            <Text style={styles.doneLabel}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    marginTop: 'auto',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  card: {
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
  },
  label: {
    ...typography.bodySemibold,
    color: colors.textPrimary,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  doneLabel: {
    ...typography.bodySemibold,
    color: colors.accentElectric,
  },
});
