import type { ComponentType, Context } from 'react';

type KindeSdkModule = {
  KindeAuthProvider: ComponentType<any>;
  KindeAuthContext: Context<any>;
};

// Keep `require` to resolve the CommonJS export in React Native/Metro.
// This avoids the ESM interop path that previously broke SecureStore init.
const kindeSdk = require('@kinde/expo') as KindeSdkModule;

export const KindeAuthProvider = kindeSdk.KindeAuthProvider;
export const KindeAuthContext = kindeSdk.KindeAuthContext;
