import { DrandFetchError, InvalidBeaconError, isUserRejection, revertErrorName } from '@arcpet/sdk';
import { BaseError } from 'viem';
import { isMessageKey, type MessageKey, type Vars } from './i18n';

type T = (key: MessageKey, vars?: Vars) => string;

/** One sentence for any failure: decoded revert name, wallet rejection, drand failure, else the short viem message. */
export function errorMessage(err: unknown, t: T): string {
  if (isUserRejection(err)) return t('error.rejected');
  if (err instanceof DrandFetchError || err instanceof InvalidBeaconError) return t('error.drand');
  const name = revertErrorName(err);
  if (name) {
    const key = `error.${name}`;
    if (isMessageKey(key)) return t(key);
    return t('error.generic', { message: name });
  }
  const message =
    err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  return t('error.generic', { message });
}
