import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  doneLabel?: string;
};

export function SettingsSheet({
  visible,
  onClose,
  title,
  children,
  doneLabel = 'Done',
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close settings" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <View style={styles.content}>{children}</View>
          <Pressable onPress={onClose} style={styles.doneBtn} accessibilityRole="button">
            <Text style={styles.doneLabel}>{doneLabel}</Text>
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
  content: { minHeight: 0 },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  doneLabel: {
    ...typography.bodySemibold,
    color: colors.accentElectric,
  },
});
