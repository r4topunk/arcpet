// Mirrors contracts/src/libraries/PetLib.sol and ArcPet.sol constants. Keep in sync (docs/SPEC.md §3-§5).

/** Arc mainnet chain id. */
export const ARC_MAINNET_CHAIN_ID = 5042;
/** ArcDraw coordinator on Arc mainnet (arc-randomness/deployments/arc-mainnet.json). */
export const ARCDRAW_COORDINATOR = '0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324' as const;

export const BASE_HUNGER_WINDOW = 24 * 60 * 60; // TH base, seconds
export const BASE_PLAY_WINDOW = 48 * 60 * 60; // TP base, seconds
export const MIN_MULTIPLIER_BPS = 8000;
export const MULTIPLIER_SPAN_BPS = 4000;
export const BPS = 10_000;
export const STAT_MAX = 100;
export const LOW_STAT_THRESHOLD = 30;
export const MAX_NAME_LENGTH = 20;
export const CALLBACK_GAS_LIMIT = 100_000;
/** D13: calendar reminder fires this many seconds before deathAt. */
export const REMINDER_LEAD_SECONDS = 6 * 60 * 60;
/** When less than REMINDER_LEAD_SECONDS remain, the reminder starts this long after `now` instead (never in the past). */
export const REMINDER_MIN_DELAY_SECONDS = 60;

export const SPECIES_NAMES = ['Blob', 'Cat', 'Bird', 'Bunny'] as const;
