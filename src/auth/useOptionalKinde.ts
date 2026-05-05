import { useContext, useMemo } from 'react';
import type { LoginMethodParams } from '@kinde/js-utils';
import { KindeAuthContext } from './kindeSdk';

export type KindeLikeHook = {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (options?: Partial<LoginMethodParams>) => Promise<{ success: boolean; errorMessage?: string }>;
  register: (options?: Partial<LoginMethodParams>) => Promise<{ success: boolean; errorMessage?: string }>;
  logout: (options?: { revokeToken?: boolean }) => Promise<unknown>;
  getUserProfile: () => Promise<unknown>;
  getDecodedToken: () => Promise<unknown>;
};

/**
 * Returns Kinde auth when `KindeAuthProvider` wraps the tree (see App.tsx + `.env`).
 * Returns `null` on web, when env vars are missing, or outside the provider.
 */
export function useOptionalKinde(): KindeLikeHook | null {
  const ctx = useContext(KindeAuthContext);
  return useMemo(() => {
    if (ctx == null) {
      return null;
    }
    return {
      isAuthenticated: ctx.isAuthenticated,
      isLoading: ctx.isLoading,
      login: ctx.login as KindeLikeHook['login'],
      register: ctx.register as KindeLikeHook['register'],
      logout: ctx.logout as KindeLikeHook['logout'],
      getUserProfile: ctx.getUserProfile as KindeLikeHook['getUserProfile'],
      getDecodedToken: ctx.getDecodedToken as KindeLikeHook['getDecodedToken'],
    };
  }, [
    ctx?.isAuthenticated,
    ctx?.isLoading,
    ctx?.login,
    ctx?.register,
    ctx?.logout,
    ctx?.getUserProfile,
    ctx?.getDecodedToken,
  ]);
}
