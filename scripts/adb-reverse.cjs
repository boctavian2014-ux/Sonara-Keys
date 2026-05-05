/**
 * Runs `adb reverse` for common Metro ports so a USB-connected device can reach localhost.
 * Resolves adb.exe without requiring platform-tools on PATH.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  console.error(
    '\n[adb-reverse] adb.exe not found. Install Android SDK Platform-Tools, then either:\n' +
      '  - Add ...\\Android\\Sdk\\platform-tools to your PATH, or\n' +
      '  - Set ANDROID_HOME to your SDK folder (e.g. %LOCALAPPDATA%\\Android\\Sdk)\n',
  );
  process.exit(1);
}

const ports = [8081, 8082, 8083];
for (const p of ports) {
  const r = spawnSync(adb, ['reverse', `tcp:${p}`, `tcp:${p}`], { stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`\n[adb-reverse] Failed for tcp:${p}. Is USB debugging enabled and the device connected?\n`);
    process.exit(r.status ?? 1);
  }
}
console.log('[adb-reverse] tcp:8081/8082/8083 reversed OK (' + adb + ')\n');
