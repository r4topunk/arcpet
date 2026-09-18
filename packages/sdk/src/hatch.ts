// Hatch flow (D8, D9, R2, R8): hatch(name) -> EggLaid(requestId, round) -> the browser fetches the drand quicknet
// signature for `round` and calls coordinator.fulfill (the ArcDraw callback writes the genes). If the callback failed,
// the coordinator still marks the request Fulfilled; then `claimGenes(id)` finishes the hatch from getRequest().
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  getAddress,
  type Hash,
  type Hex,
  parseEventLogs,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
  zeroHash,
} from 'viem';
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions';
import { arcDrawCoordinatorAbi } from './abi/ArcDrawCoordinator.js';
import { arcPetAbi } from './abi/ArcPet.js';
import { ARCDRAW_COORDINATOR } from './constants.js';
import { isValidName, type PetInfo, Status } from './pet.js';
import { readPet } from './pets.js';
import { type Beacon, type FetchBeaconOptions, fetchBeacon } from './vendor/arcdraw/drand.js';
import { worstCaseFulfillBatchGas } from './vendor/arcdraw/gas.js';
import { roundTime } from './vendor/arcdraw/rounds.js';

/** IArcDrawCoordinator.Status. */
export const RequestStatus = { None: 0, Pending: 1, Refunded: 2, Fulfilled: 3 } as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

export interface CoordinatorRequest {
  requester: Address;
  round: bigint;
  callbackGasLimit: number;
  status: RequestStatus;
  bounty: bigint;
  createdAt: bigint;
  randomness: Hex;
}

/**
 * Where an egg is in the hatch flow:
 * - `hatched`: the pet has genes (Alive, Dead or Buried); nothing to do.
 * - `waitingRound`: the pinned drand round is not published yet (`readyAt`, ~12 s after hatch).
 * - `fulfillable`: request Pending or Refunded (R8) and the round is out: call `fulfillEgg`.
 * - `claimable`: request Fulfilled but the pet is still an Egg (callback failed, R2): call `claimGenes`.
 * - `unknownRequest`: the coordinator does not know the request (should not happen for a real ArcPet egg).
 */
export type HatchPhase = 'hatched' | 'waitingRound' | 'fulfillable' | 'claimable' | 'unknownRequest';

/** Pure decision for the hatch UI. `now` is unix seconds. */
export function hatchPhase(
  petStatus: Status,
  request: Pick<CoordinatorRequest, 'status' | 'round'>,
  now: bigint,
) {
  let phase: HatchPhase;
  if (petStatus !== Status.Egg) phase = 'hatched';
  else if (request.status === RequestStatus.Fulfilled) phase = 'claimable';
  else if (request.status === RequestStatus.None) phase = 'unknownRequest';
  else phase = now < roundTime(request.round) ? 'waitingRound' : 'fulfillable';
  return { phase, readyAt: roundTime(request.round) };
}

export interface HatchStatus {
  pet: PetInfo;
  request: CoordinatorRequest;
  phase: HatchPhase;
  /** Unix time at which the pinned round is published. */
  readyAt: bigint;
  /** true when `roundRandomness(round)` is already on chain (fulfill needs no signature and no BLS check). */
  roundVerified: boolean;
}

export async function readRequest(
  client: Client,
  { coordinator = ARCDRAW_COORDINATOR, requestId }: { coordinator?: Address; requestId: bigint },
): Promise<CoordinatorRequest> {
  const r = await readContract(client, {
    address: coordinator,
    abi: arcDrawCoordinatorAbi,
    functionName: 'getRequest',
    args: [requestId],
  });
  return { ...r, status: r.status as RequestStatus };
}

async function readRoundRandomness(client: Client, coordinator: Address, round: bigint): Promise<Hex> {
  return readContract(client, {
    address: coordinator,
    abi: arcDrawCoordinatorAbi,
    functionName: 'roundRandomness',
    args: [round],
  });
}

/** Reads the pet, its ArcDraw request and the round state, and says what the hatch UI should offer. */
export async function readHatchStatus(
  client: Client,
  o: { arcPet: Address; coordinator?: Address; id: bigint; now?: bigint },
): Promise<HatchStatus> {
  const coordinator = o.coordinator ?? ARCDRAW_COORDINATOR;
  const pet = await readPet(client, { arcPet: o.arcPet, id: o.id });
  const request = await readRequest(client, { coordinator, requestId: pet.requestId });
  const roundVerified =
    request.status !== RequestStatus.None &&
    (await readRoundRandomness(client, coordinator, request.round)) !== zeroHash;
  const now = o.now ?? BigInt(Math.floor(Date.now() / 1000));
  const { phase, readyAt } = hatchPhase(pet.status, request, now);
  return { pet, request, phase, readyAt, roundVerified };
}

export interface EggLaidEvent {
  id: bigint;
  owner: Address;
  requestId: bigint;
  round: bigint;
  name: string;
}

/** Decodes the `EggLaid` event of a `hatch` receipt (undefined if the receipt has none). */
export function parseEggLaid(
  receipt: Pick<TransactionReceipt, 'logs'>,
  arcPet?: Address,
): EggLaidEvent | undefined {
  const logs = parseEventLogs({ abi: arcPetAbi, eventName: 'EggLaid', logs: receipt.logs });
  const log = logs.find((l) => !arcPet || l.address.toLowerCase() === arcPet.toLowerCase());
  if (!log) return undefined;
  const { id, owner, requestId, round, name } = log.args;
  return { id, owner: getAddress(owner), requestId, round, name };
}

type Wallet = WalletClient<Transport, Chain | undefined, Account | undefined>;

function accountOf(wallet: Wallet): Account | Address {
  const account = wallet.account;
  if (!account) throw new Error('wallet client has no account: connect a wallet first');
  return account;
}

export class InvalidPetNameError extends Error {
  override readonly name = 'InvalidPetNameError';
  constructor(readonly petName: string) {
    super('name must be 1-20 printable ASCII characters, without " & < > \\');
  }
}

/**
 * Sends `hatch(name)` and returns the tx hash as soon as the wallet broadcasts it (no receipt wait), so a UI can show
 * "pending" and an explorer link right away. Validates the name first (same rule as the contract) and simulates, so a
 * doomed call fails before the wallet prompt. Decode the egg from the receipt with `parseEggLaid`.
 */
export async function sendHatch(
  publicClient: Client,
  wallet: Wallet,
  o: { arcPet: Address; name: string },
): Promise<Hash> {
  if (!isValidName(o.name)) throw new InvalidPetNameError(o.name);
  const { request } = await simulateContract(publicClient, {
    address: o.arcPet,
    abi: arcPetAbi,
    functionName: 'hatch',
    args: [o.name],
    account: accountOf(wallet),
  });
  return writeContract(wallet, { ...request, chain: wallet.chain ?? null });
}

/** `sendHatch`, then waits for the receipt and returns the egg (id, requestId, round). For scripts. */
export async function hatch(
  publicClient: Client,
  wallet: Wallet,
  o: { arcPet: Address; name: string },
): Promise<{ hash: Hash; receipt: TransactionReceipt; egg: EggLaidEvent }> {
  const hash = await sendHatch(publicClient, wallet, o);
  const receipt = await waitForTransactionReceipt(publicClient, { hash });
  const egg = receipt.status === 'success' ? parseEggLaid(receipt, o.arcPet) : undefined;
  if (!egg) throw new Error(`hatch transaction ${hash} did not lay an egg (status ${receipt.status})`);
  return { hash, receipt, egg };
}

/**
 * The `signature` argument for `fulfill`: "0x" when the round is already verified on chain (the coordinator ignores
 * it), else the drand quicknet signature fetched over HTTP and verified locally with BLS (ArcDraw SDK `fetchBeacon`).
 */
export async function fulfillSignature(
  client: Client,
  o: { coordinator?: Address; round: bigint; beacon?: Beacon; drand?: FetchBeaconOptions },
): Promise<{ signature: Hex; freshRound: boolean }> {
  const stored = await readRoundRandomness(client, o.coordinator ?? ARCDRAW_COORDINATOR, o.round);
  if (stored !== zeroHash) return { signature: '0x', freshRound: false };
  const beacon = o.beacon ?? (await fetchBeacon(o.round, o.drand));
  if (beacon.round !== o.round) throw new Error(`beacon is for round ${beacon.round}, expected ${o.round}`);
  return { signature: beacon.signature, freshRound: true };
}

/**
 * Browser fulfill of an egg's ArcDraw request (D9): fetches the round signature and calls `coordinator.fulfill`.
 * The gas limit is the ArcDraw worst-case bound (`worstCaseFulfillBatchGas`) rather than eth_estimateGas, so the
 * coordinator always has the full 100k callback budget and the callback is not starved into the claimGenes path.
 * Anyone can fulfill any egg; the wallet pays gas (bounty is 0).
 */
export async function fulfillEgg(
  publicClient: Client,
  wallet: Wallet,
  o: { coordinator?: Address; requestId: bigint; beacon?: Beacon; drand?: FetchBeaconOptions },
): Promise<Hash> {
  const coordinator = o.coordinator ?? ARCDRAW_COORDINATOR;
  const req = await readRequest(publicClient, { coordinator, requestId: o.requestId });
  if (req.status === RequestStatus.None) throw new Error(`ArcDraw request ${o.requestId} does not exist`);
  if (req.status === RequestStatus.Fulfilled)
    throw new Error(`ArcDraw request ${o.requestId} is already fulfilled`);
  const { signature, freshRound } = await fulfillSignature(publicClient, {
    coordinator,
    round: req.round,
    ...(o.beacon ? { beacon: o.beacon } : {}),
    ...(o.drand ? { drand: o.drand } : {}),
  });
  const gas = worstCaseFulfillBatchGas({ freshRound, callbackGasLimits: [req.callbackGasLimit] });
  const { request } = await simulateContract(publicClient, {
    address: coordinator,
    abi: arcDrawCoordinatorAbi,
    functionName: 'fulfill',
    args: [o.requestId, signature],
    account: accountOf(wallet),
    gas,
  });
  return writeContract(wallet, { ...request, chain: wallet.chain ?? null });
}

/** Sends one of ArcPet's `uint256 id` actions (anyone may call each of them). Simulates first. */
export async function sendPetAction(
  publicClient: Client,
  wallet: Wallet,
  o: { arcPet: Address; id: bigint; action: 'feed' | 'play' | 'bury' | 'claimGenes' },
): Promise<Hash> {
  const { request } = await simulateContract(publicClient, {
    address: o.arcPet,
    abi: arcPetAbi,
    functionName: o.action,
    args: [o.id],
    account: accountOf(wallet),
  });
  return writeContract(wallet, { ...request, chain: wallet.chain ?? null });
}

/** R2 fallback: finish the hatch from the coordinator's stored randomness when the callback failed. */
export function claimGenes(publicClient: Client, wallet: Wallet, o: { arcPet: Address; id: bigint }) {
  return sendPetAction(publicClient, wallet, { ...o, action: 'claimGenes' });
}
