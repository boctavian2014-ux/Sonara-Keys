/**
 * Design system — Sonara Keys (premium dark, iOS-first)
 *
 * Principles:
 * - Deep navy / indigo base with electric blue and teal accents.
 * - Spacing on a 4pt grid; touch targets ≥ 44pt.
 * - Radius: cards xl (20), pills full, hero circle symmetric.
 * - Soft shadows; avoid flat neon blocks.
 *
 * Reanimated (optional later): drive ring `scale`/`opacity` with
 * `useSharedValue` + `withRepeat(withTiming(...), -1, true)` on the listening state;
 * add `FadeInDown` for cards on mount.
 */

export const colors = {
  bgDeep: '#0A0E1A',
  bgMid: '#12182A',
  bgElevated: '#161D32',
  surfaceGlass: 'rgba(255, 255, 255, 0.06)',
  surfaceGlassStrong: 'rgba(255, 255, 255, 0.10)',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  accentBlue: '#3B82F6',
  accentElectric: '#60A5FA',
  accentTeal: '#2DD4BF',
  accentIndigo: '#6366F1',
  heroInner: '#1E3A5F',
  heroGlow: 'rgba(96, 165, 250, 0.45)',
  listenActive: '#F43F5E',
  listenActiveRing: 'rgba(244, 63, 94, 0.35)',
  textPrimary: '#F8FAFC',
  textSecondary: 'rgba(248, 250, 252, 0.72)',
  textMuted: 'rgba(248, 250, 252, 0.48)',
  textInverse: '#0F172A',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#FB7185',
  staffPaper: '#F1F5F9',
  staffPaperBorder: 'rgba(15, 23, 42, 0.12)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  hero: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
} as const;

export const typography = {
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 1.2 },
  caption: { fontSize: 13, fontWeight: '500' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodySemibold: { fontSize: 15, fontWeight: '600' as const },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  heroNote: { fontSize: 56, fontWeight: '700' as const, letterSpacing: -2 },
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
};

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 14,
  },
  hero: {
    shadowColor: '#60A5FA',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 20,
  },
  heroActive: {
    shadowColor: '#F43F5E',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.38,
    shadowRadius: 28,
    elevation: 18,
  },
  soft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;

export const layout = {
  maxContentWidth: 560,
  headerIconSize: 44,
  heroButtonSize: 208,
  ringInset: 18,
};

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  layout,
} as const;

export type Theme = typeof theme;
