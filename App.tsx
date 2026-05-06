/**
 * Sonara Keys — native build for PCM (`@edkimmel/expo-audio-stream`).
 * Run: `npx expo run:android` / `run:ios` (Expo Go lacks the native module).
 *
 * Navigation: simple root switch (no React Navigation in package.json).
 * See `src/navigation/INTEGRATION.md` to migrate to a stack or Expo Router.
 */
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getKindeAuthConfig, getKindeRequireLoginAtStartup } from './src/auth/kindeConfig';
import { KindeAuthProvider } from './src/auth/kindeSdk';
import { useOptionalKinde } from './src/auth/useOptionalKinde';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import PracticeScreen from './src/screens/PracticeScreen';
import type { PracticeOpenSource } from './types/practiceRoute';

function AppInner({ requireKindeAuth }: { requireKindeAuth: boolean }) {
  const kinde = useOptionalKinde();
  const [screen, setScreen] = useState<'home' | 'practice'>('home');
  const [practiceOpen, setPracticeOpen] = useState<PracticeOpenSource>({ kind: 'sample' });

  if (requireKindeAuth && (kinde == null || kinde.isLoading || !kinde.isAuthenticated)) {
    return <AuthScreen kinde={kinde} />;
  }

  return (
    <>
      {screen === 'home' ? (
        <HomeScreen
          onOpenPractice={(route) => {
            setPracticeOpen(route);
            setScreen('practice');
          }}
        />
      ) : (
        <PracticeScreen
          key={practiceOpen.kind === 'saved' ? practiceOpen.saved.id : 'sample'}
          practiceOpen={practiceOpen}
          onBack={() => {
            setScreen('home');
            setPracticeOpen({ kind: 'sample' });
          }}
        />
      )}
    </>
  );
}

export default function App() {
  const kindeCfg = useMemo(() => getKindeAuthConfig(), []);
  const [kindeStorageReady, setKindeStorageReady] = useState<boolean>(false);

  useEffect(() => {
    if (kindeCfg == null || Platform.OS === 'web') {
      setKindeStorageReady(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const secureStore = await import('expo-secure-store');
        const isAvailable =
          typeof secureStore.isAvailableAsync === 'function'
            ? await secureStore.isAvailableAsync()
            : false;
        if (!cancelled) {
          setKindeStorageReady(Boolean(isAvailable));
        }
      } catch {
        if (!cancelled) {
          setKindeStorageReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kindeCfg]);

  const enableKinde = kindeCfg != null && Platform.OS !== 'web' && kindeStorageReady;

  const tree = (
    <SafeAreaProvider>
      <AppInner requireKindeAuth={enableKinde && getKindeRequireLoginAtStartup()} />
    </SafeAreaProvider>
  );

  if (!enableKinde) {
    return tree;
  }

  return (
    <KindeAuthProvider
      config={{
        domain: kindeCfg.domain,
        clientId: kindeCfg.clientId,
      }}
      callbacks={{
        onError: (props) => {
          console.warn('[KindeAuth]', props.error, props.errorDescription);
        },
      }}
    >
      {tree}
    </KindeAuthProvider>
  );
}
