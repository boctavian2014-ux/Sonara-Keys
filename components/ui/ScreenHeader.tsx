import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radius, spacing, typography } from '../../theme';

import { AppMark } from './AppMark';

type Props = {
  title: string;
  subtitle?: string;
  /** Opens account / login (e.g. settings modal). Shown left of settings when set. */
  onAccountPress?: () => void;
  onSettingsPress: () => void;
};

export function ScreenHeader({ title, subtitle, onAccountPress, onSettingsPress }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <AppMark size={44} />
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.rightActions}>
        {onAccountPress ? (
          <Pressable
            onPress={onAccountPress}
            style={({ pressed }) => [styles.accountBtn, pressed && styles.iconBtnPressed]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cont și autentificare"
          >
            <Text style={styles.accountBtnText}>Cont</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSettingsPress}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={styles.gearGlyph} accessibilityElementsHidden>
            ⚙︎
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const G = layout.headerIconSize;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  accountBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: G,
    justifyContent: 'center',
  },
  accountBtnText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minHeight: G,
    paddingRight: spacing.md,
  },
  titles: {
    marginLeft: spacing.md,
    flexShrink: 1,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  iconBtn: {
    width: G,
    height: G,
    borderRadius: G / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  iconBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  gearGlyph: {
    fontSize: 22,
    color: colors.textSecondary,
    lineHeight: 24,
  },
});
