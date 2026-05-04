import * as tf from '@tensorflow/tfjs';

/**
 * React Native: tfjs may have no `env().platform.fetch` — model load would fail.
 */
export function ensureTfjsPlatformForReactNative(): void {
  const e = tf.env();
  if (e.platform != null && typeof e.platform.fetch === 'function') {
    return;
  }
  const g = globalThis as typeof globalThis & { fetch?: typeof fetch };
  const fetchImpl = typeof g.fetch === 'function' ? g.fetch.bind(g) : fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to load the Basic Pitch model from the network.');
  }
  e.setPlatform('react-native', {
    fetch: (path, init) => fetchImpl(path as string, init),
    now: () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
    encode(text, encoding) {
      if (encoding !== 'utf-8' && encoding !== 'utf8') {
        throw new Error(`encode: only utf-8 supported, got ${encoding}`);
      }
      return new TextEncoder().encode(text);
    },
    decode(bytes, encoding) {
      return new TextDecoder(encoding).decode(bytes);
    },
  });
}
