/**
 * Sonara Keys — native build for PCM (`@edkimmel/expo-audio-stream`).
 * Run: `npx expo run:android` / `run:ios` (Expo Go lacks the native module).
 *
 * Navigation: simple root switch (no React Navigation in package.json).
 * See `src/navigation/INTEGRATION.md` to migrate to a stack or Expo Router.
 */
import { KindeAuthProvider } from '@kinde/expo';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getKindeAuthConfig } from './src/auth/kindeConfig';
import HomeScreen from './src/screens/HomeScreen';
import PracticeScreen from './src/screens/PracticeScreen';
import type { PracticeOpenSource } from './types/practiceRoute';

function AppInner() {
  const [screen, setScreen] = useState<'home' | 'practice'>('home');
  const [practiceOpen, setPracticeOpen] = useState<PracticeOpenSource>({ kind: 'sample' });

  return (
    <SafeAreaProvider>
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
    </SafeAreaProvider>
  );
}

export default function App() {
  const kinde = getKindeAuthConfig();
  if (kinde != null) {
    return (
      <KindeAuthProvider
        config={{
          domain: kinde.domain,
          clientId: kinde.clientId,
          scopes: 'openid profile email offline',
        }}
      >
        <AppInner />
      </KindeAuthProvider>
    );
  }
  return <AppInner />;
}
