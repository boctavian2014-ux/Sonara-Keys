import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '../../components/ui/GlassCard';
import { GradientScreenBackground } from '../../components/ui/GradientScreenBackground';
import { colors, layout, radius, spacing, typography } from '../../theme';
import type { KindeLikeHook } from '../auth/useOptionalKinde';

type SocialProvider = {
  key: string;
  label: string;
  connectionId: string | null;
};

type AuthScreenProps = {
  kinde: KindeLikeHook | null;
};

const KINDE_REDIRECT_URL = 'sonarakeys://kinde_callback';
const KINDE_REDIRECT_URL_SLASH = 'sonarakeys://kinde_callback/';

function readConnectionId(envValue: string | undefined): string | null {
  if (typeof envValue !== 'string') return null;
  const v = envValue.trim();
  return v.length > 0 ? v : null;
}

export default function AuthScreen({ kinde }: AuthScreenProps) {
  const [busy, setBusy] = useState(false);

  const socialProviders = useMemo<SocialProvider[]>(
    () => [
      {
        key: 'google',
        label: 'Continua cu Google',
        connectionId: readConnectionId(process.env.EXPO_PUBLIC_KINDE_CONNECTION_ID_GOOGLE),
      },
      {
        key: 'apple',
        label: 'Continua cu Apple',
        connectionId: readConnectionId(process.env.EXPO_PUBLIC_KINDE_CONNECTION_ID_APPLE),
      },
      {
        key: 'facebook',
        label: 'Continua cu Facebook',
        connectionId: readConnectionId(process.env.EXPO_PUBLIC_KINDE_CONNECTION_ID_FACEBOOK),
      },
    ].filter((p) => p.connectionId != null),
    [],
  );

  const runLogin = async (connectionId?: string) => {
    if (kinde == null || busy) return;
    setBusy(true);
    try {
      const attempts = [
        { redirectURL: KINDE_REDIRECT_URL, hasSuccessPage: false, ...(connectionId ? { connectionId } : null) },
        { redirectURL: KINDE_REDIRECT_URL_SLASH, hasSuccessPage: false, ...(connectionId ? { connectionId } : null) },
        connectionId ? { connectionId, hasSuccessPage: false } : { hasSuccessPage: false },
      ] as const;

      let response: { success: boolean; errorMessage?: string } = { success: false, errorMessage: 'Unknown error' };
      for (const opts of attempts) {
        response = await kinde.login(opts);
        if (response.success) break;
      }
      if (!response.success) {
        Alert.alert(
          'Autentificare',
          response.errorMessage ||
            'Login a eșuat la code exchange. Verifică în Kinde callback-urile cu și fără slash pentru kinde_callback.',
        );
      }
    } catch (e) {
      Alert.alert('Autentificare', e instanceof Error ? e.message : 'Eroare necunoscută.');
    } finally {
      setBusy(false);
    }
  };

  const runRegister = async () => {
    if (kinde == null || busy) return;
    setBusy(true);
    try {
      const attempts = [
        { redirectURL: KINDE_REDIRECT_URL, hasSuccessPage: false },
        { redirectURL: KINDE_REDIRECT_URL_SLASH, hasSuccessPage: false },
        { hasSuccessPage: false },
      ] as const;

      let response: { success: boolean; errorMessage?: string } = { success: false, errorMessage: 'Unknown error' };
      for (const opts of attempts) {
        response = await kinde.register(opts);
        if (response.success) break;
      }
      if (!response.success) {
        Alert.alert(
          'Cont nou',
          response.errorMessage ||
            'Înregistrarea a eșuat la code exchange. Verifică callback-urile Kinde pentru kinde_callback.',
        );
      }
    } catch (e) {
      Alert.alert('Cont nou', e instanceof Error ? e.message : 'Eroare necunoscută.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GradientScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <GlassCard style={styles.card}>
            <Text style={styles.title}>Bun venit in Sonara Keys</Text>
            <Text style={styles.subtitle}>
              Autentifica-te cu Kinde ca sa sincronizezi melodiile in cloud si sa continui de pe orice dispozitiv.
            </Text>

            {kinde == null || kinde.isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.accentTeal} />
                <Text style={styles.loadingText}>Pregatim autentificarea...</Text>
              </View>
            ) : (
              <>
                {socialProviders.map((provider) => (
                  <Pressable
                    key={provider.key}
                    onPress={() => void runLogin(provider.connectionId ?? undefined)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      busy && styles.btnDisabled,
                      pressed && !busy && styles.btnPressed,
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>{provider.label}</Text>
                  </Pressable>
                ))}

                <Pressable
                  onPress={() => void runLogin()}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    busy && styles.btnDisabled,
                    pressed && !busy && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>Login Kinde</Text>
                </Pressable>

                <Pressable
                  onPress={() => void runRegister()}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    busy && styles.btnDisabled,
                    pressed && !busy && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>Creeaza cont</Text>
                </Pressable>
              </>
            )}
          </GlassCard>
        </View>
      </SafeAreaView>
    </GradientScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: layout.contentPadding,
    justifyContent: 'center',
  },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body.fontSize,
    fontWeight: typography.body.fontWeight,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
  },
  primaryBtn: {
    borderRadius: radius.lg,
    backgroundColor: colors.accentTeal,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#082f2a',
    fontWeight: typography.bodySemibold.fontWeight,
    fontSize: typography.bodySemibold.fontSize,
  },
  secondaryBtn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontWeight: typography.bodySemibold.fontWeight,
    fontSize: typography.bodySemibold.fontSize,
  },
  btnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
