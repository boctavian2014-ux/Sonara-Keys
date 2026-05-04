import { KindeAuthContext } from '@kinde/expo';
import { useContext } from 'react';

/** `null` dacă Kinde nu e configurat în `.env` sau provider-ul lipsește. */
export function useOptionalKinde() {
  return useContext(KindeAuthContext) ?? null;
}
