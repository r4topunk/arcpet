import { BaseError, ContractFunctionRevertedError } from 'viem';

/** Custom errors ArcPet can revert with (IArcPet.sol), for UI translation. */
export const ARCPET_ERRORS = [
  'NonexistentPet',
  'PetDead',
  'NotHatched',
  'AlreadyHatched',
  'NotDead',
  'AlreadyBuried',
  'AlreadyHasPet',
  'InvalidName',
  'RequestNotFulfilled',
  'Soulbound',
] as const;
export type ArcPetErrorName = (typeof ARCPET_ERRORS)[number];

/**
 * The decoded custom error name of a reverted call (ArcPet or ArcDraw coordinator errors, e.g. `PetDead` or
 * `RoundNotReady`), or undefined when the failure was not a decoded revert (RPC, user rejection, ...).
 */
export function revertErrorName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? undefined;
  return undefined;
}

/** true when the wallet user rejected the request (EIP-1193 code 4001). */
export function isUserRejection(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return !!err.walk(
    (e) => (e as { code?: number }).code === 4001 || (e as Error).name === 'UserRejectedRequestError',
  );
}
