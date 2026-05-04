# Sonara Keys

Real-time note detection and practice: microphone pitch pipeline, staff view, and local melody library.

## Requirements

- Node.js 18+ (for Expo CLI)
- Expo Dev Client (native build)
- iOS: Xcode + physical device or simulator (microphone works on both)
- Android: Android Studio + physical device or emulator with audio input
- **Web:** Microphone native module not available — practice mode shows fallback message

## Installation

```bash
npm install
```

## Running the App

### Development (Expo Go limitations)

```bash
npx expo start
```

Scan QR with Expo Go (Android) or Camera app (iOS). **Note:** Microphone live detection requires a **development build** because `@edkimmel/expo-audio-stream` is a native module not available in Expo Go.

### Native Development Builds

```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```

These commands build a native binary and install it on a connected device/emulator. Use `--device` to target a specific device.

### Web

```bash
npm run web
```

Only autoplay + keyboard tap available; microphone disabled.

## Features (MVP)

- Live pitch detection via YIN algorithm (on-device)
- Practice mode: play along with highlighted notes, get instant feedback (correct/wrong)
- Auto-play: hear the melody first
- Save melodies to local library (expo-file-system)
- Staff view with real-time note highlighting
- On-screen keyboard (touch + mouse)
- Sound feedback via ToneSynth (sine-wave WAV)

## Native Module

The app uses `@edkimmel/expo-audio-stream` for PCM audio capture. This requires:

- `app.json` includes plugin: `"@edkimmel/expo-audio-stream"`
- iOS `Info.plist`: `NSMicrophoneUsageDescription` (already set)
- Android `AndroidManifest.xml`: `RECORD_AUDIO` permission (already set via `app.json`)

## Troubleshooting

- **Module not found in Expo Go:** Expected — use `npx expo run:android` or `npx expo run:ios`
- **Microphone denied:** Check device settings; on Android, ensure app has RECORD_AUDIO permission
- **Web:** No microphone support; use native build for full practice
