/**
 * Detox E2E — needs a **debug** dev-client APK and a running emulator.
 * 1) `npx expo prebuild` (once) then `npm run test:e2e:build:android`
 *    — or `npx expo run:android` to produce `android/app/build/outputs/apk/debug/app-debug.apk`
 * 2) Set DETOX_ANDROID_AVD to your AVD name (`emulator -list-avds`) if the default does not exist.
 */
const avdName = process.env.DETOX_ANDROID_AVD || 'Medium_Phone_API_35';

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'npx expo run:android --no-install --no-bundler',
    },
  },
  devices: {
    emulator: {
      type: 'android.emulator',
      device: { avdName },
    },
  },
  configurations: {
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
};
