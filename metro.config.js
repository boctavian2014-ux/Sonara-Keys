// @tensorflow/tfjs: "main" = dist/tf.node.js (Node). "module" = dist/index.js (browser).
// Expo default resolverMainFields is ['react-native','browser','main']; here "browser"
// is a remap object, not a string, so Metro skipped it and always picked "main".
// Including "module" before "main" fixes RN bundling for tfjs and @spotify/basic-pitch.
//
// Important: the npm "punycode" package exposes "module": punycode.es6.js (named ESM only).
// whatwg-url-without-unicode (Expo Winter URL) does require('punycode').ucs2.decode — that
// breaks when Metro picks the ESM entry. Force the CJS build which exports .ucs2.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.resolverMainFields = [
  'react-native',
  'browser',
  'module',
  'main',
];

const punycodeCjs = path.join(__dirname, 'node_modules', 'punycode', 'punycode.js');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'punycode') {
    return { type: 'sourceFile', filePath: punycodeCjs };
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
