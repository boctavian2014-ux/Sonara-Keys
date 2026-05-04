/**
 * Sonara Keys — unified brand tokens (colors, spacing, type, components).
 * Use alongside or instead of `theme.ts` / `practiceTheme` as you migrate screens.
 */

export const sonaraTheme = {
  brand: {
    name: 'Sonara Keys',
    tagline: 'From score to sound, one key at a time.',
  },

  colors: {
    // Backgrounds
    bgDeep: '#07111F',
    bgElevated: 'rgba(17, 30, 56, 0.82)',

    // Borders
    borderSubtle: 'rgba(151, 179, 255, 0.16)',
    borderStrong: 'rgba(255, 255, 255, 0.14)',

    // Brand accents
    primary: '#3AA0FF',
    accentTeal: '#2DD4BF',
    accentIndigo: '#6366F1',

    // Text
    textPrimary: '#F4F7FF',
    textMuted: '#A9B7D6',
    textInverse: '#0F172A',

    // Feedback
    success: '#72E28A',
    danger: '#FF7B9C',
    warning: '#FBBF24',

    // Keys
    whiteKey: '#E8EAF0',
    blackKey: '#1A1F2E',

    // Logo / icon
    logoFill: '#E8F1FF',
    logoGlow: 'rgba(58, 160, 255, 0.45)',
  },

  spacing: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
    hero: 40,
  },

  radius: {
    card: 18,
    pill: 999,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
    full: 9999,
  },

  typography: {
    labelMicro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 1.2 },
    caption: { fontSize: 13, fontWeight: '500' as const },
    body: { fontSize: 15, fontWeight: '400' as const },
    bodySemibold: { fontSize: 15, fontWeight: '600' as const },
    title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
    display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
  },

  shadows: {
    card: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 14,
    },
    soft: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 8,
    },
  },

  components: {
    buttonPrimary: {
      bg: '#3AA0FF',
      text: '#0F172A',
      radius: 18,
      minHeight: 44,
    },
    buttonSecondary: {
      bg: 'transparent',
      border: 'rgba(151, 179, 255, 0.16)',
      text: '#A9B7D6',
      radius: 18,
      minHeight: 44,
    },
    statusPill: {
      bg: 'rgba(58, 160, 255, 0.18)',
      border: 'rgba(151, 179, 255, 0.16)',
      text: '#3AA0FF',
      radius: 999,
    },
  },
} as const;

export type SonaraTheme = typeof sonaraTheme;
