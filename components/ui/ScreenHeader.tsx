import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, typography } from '../../theme';

import { AppMark } from './AppMark';

type Props = {
  title: string;
  subtitle?: string;
  onSettingsPress: () => void;
};

export function ScreenHeader({ title, subtitle, onSettingsPress }: Props) {
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
