/**
 * Opens the Expo dev client with Metro at http://127.0.0.1:<port> (works with adb reverse).
 * Must match the scheme in android/app/src/main/AndroidManifest.xml (exp+piano-notes-mvp).
 *
 * Usage: node scripts/open-dev-client-local.cjs [port]
 *   PORT=8082 node scripts/open-dev-client-local.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || process.argv[2] || 8081) || 8081;
const metroUrl = `http://127.0.0.1:${port}`;
const encoded = encodeURIComponent(metroUrl);
/** Same host part as expo run:android logs (see AndroidManifest data android:scheme) */
const devClientUri = `exp+piano-notes-mvp://expo-development-client/?url=${encoded}`;

function findAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'),
  ].filter(Boolean);
  const name = process.platform === 'win32' ? 'adb.exe' : 'adb';
  for (const root of roots) {
    const p = path.join(root, 'platform-tools', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const adb = findAdb();
if (!adb) {
  console.error('[open-dev-client-local] adb.exe not found.\n');
  process.exit(1);
}

console.log(`[open-dev-client-local] Launching dev client → ${metroUrl}\n  ${devClientUri}\n`);

const r = spawnSync(
  adb,
  ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', devClientUri],
  { stdio: 'inherit', shell: false },
);
process.exit(r.status ?? 1);
