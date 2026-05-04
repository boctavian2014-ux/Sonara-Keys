# Navigation: Home and Practice

This project does **not** include `@react-navigation/native` or Expo Router. Navigation is a **single root switch** in [`App.tsx`](../../App.tsx):

- State: `screen: 'home' | 'practice'`.
- `HomeScreen` receives `onOpenPractice={(route) => { setPracticeOpen(route); setScreen('practice'); }}` (see `App.tsx` + `types/practiceRoute.ts`).
- `PracticeScreen` receives `onBack={() => setScreen('home')}`.

Only one screen is mounted at a time so the microphone is owned by either `useAudioPitch` on Home or Practice, not both.

### If you add React Navigation later

1. `npm install @react-navigation/native @react-navigation/native-stack`
2. Follow Expo docs for dependencies (`react-native-screens`, etc.).
3. Register a stack with `Home` and `Practice` routes; replace the `screen` state in `App.tsx` with `navigation.navigate('Practice')` from the Home CTA.

### If you add Expo Router

1. `npx expo install expo-router`
2. Move `screens/HomeScreen.tsx` to `app/index.tsx` (or keep imports) and add `app/practice.tsx` that renders `PracticeScreen` with `router.back()`.
