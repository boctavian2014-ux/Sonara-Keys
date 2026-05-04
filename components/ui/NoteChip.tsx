import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

type Props = {
  label: string;
  muted?: boolean;
};

export function NoteChip({ label, muted }: Props) {
  return (
    <View style={[styles.wrap, muted && styles.wrapMuted]}>
      <Text style={[styles.text, muted && styles.textMuted]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  wrapMuted: {
    opacity: 0.55,
  },
  text: {
    ...typography.bodySemibold,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  textMuted: {
    color: colors.textSecondary,
  },
});
