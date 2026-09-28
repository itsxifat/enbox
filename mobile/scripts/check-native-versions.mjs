/**
 * Fails when an installed native module doesn't match the version the Expo SDK expects.
 *
 * `expo install --check` only looks at direct dependencies. A package pulled in another way
 * (e.g. npm auto-installing a `*` peer dependency at its newest release) is still autolinked
 * into the APK, and a native module built for another SDK crashes the app on launch. That
 * happened with expo-audio's `expo-asset: *` peer.
 *
 *   node scripts/check-native-versions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const semver = require('semver');
const expected = require('expo/bundledNativeModules.json');

const mismatches = [];
for (const [name, range] of Object.entries(expected)) {
  const manifest = path.join(root, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!semver.satisfies(version, range))
    mismatches.push(`${name}@${version} (SDK expects ${range})`);
}

if (mismatches.length) {
  console.error(
    `Native modules that don't match this Expo SDK:\n  ${mismatches.join('\n  ')}\n` +
      'Add each one as a direct dependency with `npx expo install <name>`.',
  );
  process.exit(1);
}
console.log('All installed native modules match the Expo SDK.');
