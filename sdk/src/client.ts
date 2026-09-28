// Client.
import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { ContractErrorCode, describeContractError, parseContractErrorCode } from "./errors";

export enum CircleStatus {
  Forming = 0,
  Active = 1,
  Completed = 2,
  Cancelled = 3,
}

export interface Circle {
  id: bigint;
  creator: string;
  token: string;
  contributionAmount: bigint;
  securityDeposit?: bigint;
  maxMembers: number;
  cycleLengthSecs: bigint;
  /** Join order doubles as payout order — members[0] is paid first. */
  members: string[];
  startedAt: bigint;
  currentCycle: number;
  status: CircleStatus;
}

/** Type alias for Circle (#64). */
export type CircleState = Circle;

// soroban-sdk maps Rust struct field names verbatim (snake_case) into the
// decoded object's keys — this is the raw shape before we camelCase it.
interface RawCircle {
  id: bigint;
  creator: string;
  token: string;
  contribution_amount: bigint;
  security_deposit?: bigint;
  max_members: number;
  cycle_length_secs: bigint;
  members: string[];
  started_at: bigint;
  current_cycle: number;
  status: number;
}

function parseCircle(raw: RawCircle): Circle {
  return {
    id: raw.id,
    creator: raw.creator,
    token: raw.token,
    contributionAmount: raw.contribution_amount,
    securityDeposit: raw.security_deposit ?? 0n,
    maxMembers: raw.max_members,
    cycleLengthSecs: raw.cycle_length_secs,
    members: raw.members,
    startedAt: raw.started_at,
    currentCycle: raw.current_cycle,
    status: raw.status as CircleStatus,
  };
}

export class AjoContractError extends Error {
  /** The contract's `ContractError` code, when the failure was one. */
  readonly code: ContractErrorCode | null;

  constructor(message: string, code: ContractErrorCode | null = null) {
    super(message);
    this.name = "AjoContractError";
    this.code = code;
  }

  /** Build from a raw simulation error, resolving known contract error codes. */
  static fromSimulationError(raw: string): AjoContractError {
    return new AjoContractError(describeContractError(raw), parseContractErrorCode(raw));
  }
}

export interface AjoClientConfig {
  contractId: string;
  /** Defaults to Stellar testnet. */
  rpcUrl?: string;
  networkPassphrase?: string;
}

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Decode a transaction's Soroban return value to a native JS value, or
 * `undefined` when the call returned nothing.
 */
export function decodeReturnValue<T = unknown>(returnValue: xdr.ScVal | undefined): T | undefined {
  if (returnValue === undefined || returnValue.switch() === xdr.ScValType.scvVoid()) return undefined;
  return scValToNative(returnValue) as T;
}

const SEND_TX_MAX_ATTEMPTS = 5;
const SEND_TX_RETRY_BASE_DELAY_MS = 500;

/**
 * Calls `server.sendTransaction`, retrying with exponential backoff on
 * `TRY_AGAIN_LATER` — the node's mempool was busy and the transaction was
 * never actually broadcast, so falling straight into the `getTransaction`
 * poll loop would never find it and would only time out after the full
 * ~60s window (#150). `DUPLICATE` and `PENDING` are returned as-is: a
 * duplicate submission is treated as success by the caller, which proceeds
 * to poll for the (already-submitted) transaction as normal.
 */
export async function sendWithRetry(
  server: rpc.Server,
  tx: Transaction | FeeBumpTransaction,
): Promise<rpc.Api.SendTransactionResponse> {
  let sent = await server.sendTransaction(tx);
  for (
    let attempt = 0;
    sent.status === "TRY_AGAIN_LATER" && attempt < SEND_TX_MAX_ATTEMPTS;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, SEND_TX_RETRY_BASE_DELAY_MS * 2 ** attempt));
    sent = await server.sendTransaction(tx);
  }
  return sent;
}

/**
 * A thin, non-custodial client for the Ajo circle contract.
 *
 * This client never holds or requests a private key. Every state-changing
 * method returns an *unsigned* transaction XDR string — the caller signs it
 * with whatever wallet they control (Freighter, a server-side Keypair, a
 * hardware signer, anything that can sign a Stellar transaction) and passes
 * the result to `submitSignedTx`. Read methods need no signer at all; they
 * simulate against a throwaway account.
 */
export class AjoClient {
  readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly contractId: string;
  private readonly networkPassphrase: string;

  constructor(config: AjoClientConfig) {
    this.server = new rpc.Server(config.rpcUrl ?? DEFAULT_RPC_URL);
    this.contract = new Contract(config.contractId);
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
  }

  // ---- reads ----

  async getCircle(circleId: bigint): Promise<Circle> {
    const raw = await this.readCall<RawCircle>("get_circle", [nativeToScVal(circleId, { type: "u64" })]);
    return parseCircle(raw);
  }

  async hasContributed(circleId: bigint, cycle: number, member: string): Promise<boolean> {
    return this.readCall<boolean>("has_contributed", [
      nativeToScVal(circleId, { type: "u64" }),
      nativeToScVal(cycle, { type: "u32" }),
      new Address(member).toScVal(),
    ]);
  }

  async missedCount(circleId: bigint, member: string): Promise<number> {
    return this.readCall<number>("missed_count", [
      nativeToScVal(circleId, { type: "u64" }),
      new Address(member).toScVal(),
    ]);
  }

  async totalCircles(): Promise<bigint> {
    return this.readCall<bigint>("total_circles", []);
  }

  /**
   * Reads `(circle, created)` events from the contract's own log — no
   * indexer required.
   *
   * The default lookback (9,000 ledgers, ~12.5h at ~5s/ledger) is deliberately
   * far short of the ~120,960-ledger (~7 day) window the RPC node reports as
   * its retention floor. Empirically, public Soroban RPC nodes accept a
   * `startLedger` anywhere inside that whole retention window without
   * erroring, but silently return zero events — not an error, just an empty
   * result — once the requested span exceeds a much smaller *searchable*
   * window (somewhere between 10,000 and 12,000 ledgers on the node this was
   * tested against). Retention and searchability are not the same guarantee;
   * only the latter actually matters here. Circles older than this lookback
   * still resolve fine by id — `getCircle` reads contract storage directly,
   * not events — they just won't surface from a cold discovery scan.
   */
  async discoverCircleIds(lookbackLedgers = 9_000, limit = 50): Promise<bigint[]> {
    const latest = await this.server.getLatestLedger();
    const startLedger = Math.max(latest.sequence - lookbackLedgers, 1);

    const fetchEvents = (from: number) =>
      this.server.getEvents({
        startLedger: from,
        filters: [
          {
            type: "contract",
            contractIds: [this.contractId],
            topics: [
              [xdr.ScVal.scvSymbol("circle").toXDR("base64"), xdr.ScVal.scvSymbol("created").toXDR("base64")],
            ],
          },
        ],
        limit,
      });

    let res;
    try {
      res = await fetchEvents(startLedger);
    } catch (err) {
      // The RPC node's actual retention floor can advance past what we
      // computed from getLatestLedger() by the time getEvents() runs —
      // ledgers keep closing in between the two calls, and public nodes
      // often retain fewer ledgers than a naive "N days at ~5s/ledger"
      // estimate assumes. Retry once against the floor the server itself
      // reports rather than guessing a smaller lookback.
      const min = minLedgerFromRangeError(err);
      if (min === null) throw err;
      res = await fetchEvents(min);
    }

    return res.events.map((e) => scValToNative(e.value) as bigint).reverse();
  }

  // ---- writes: build an unsigned, simulated-and-assembled tx for the caller to sign ----

  async buildCreateCircleTx(
    creator: string,
    token: string,
    contributionAmount: bigint,
    maxMembers: number,
    cycleLengthSecs: bigint,
  ): Promise<string> {
    return this.buildTx(creator, "create_circle", [
      new Address(creator).toScVal(),
      new Address(token).toScVal(),
      nativeToScVal(contributionAmount, { type: "i128" }),
      nativeToScVal(maxMembers, { type: "u32" }),
      nativeToScVal(cycleLengthSecs, { type: "u64" }),
    ]);
  }

  async buildJoinCircleTx(circleId: bigint, member: string): Promise<string> {
    return this.buildTx(member, "join_circle", [
      nativeToScVal(circleId, { type: "u64" }),
      new Address(member).toScVal(),
    ]);
  }

  async buildLeaveCircleTx(circleId: bigint, member: string): Promise<string> {
    return this.buildTx(member, "leave_circle", [
      nativeToScVal(circleId, { type: "u64" }),
      new Address(member).toScVal(),
    ]);
  }

  async buildCancelCircleTx(circleId: bigint, caller: string): Promise<string> {
    return this.buildTx(caller, "cancel_circle", [
      nativeToScVal(circleId, { type: "u64" }),
      new Address(caller).toScVal(),
    ]);
  }

  async buildContributeTx(circleId: bigint, member: string): Promise<string> {
    return this.buildTx(member, "contribute", [
      nativeToScVal(circleId, { type: "u64" }),
      new Address(member).toScVal(),
    ]);
  }

  /** Callable by anyone — no privileged keeper role. */
  async buildDisburseTx(circleId: bigint, caller: string): Promise<string> {
    return this.buildTx(caller, "disburse", [nativeToScVal(circleId, { type: "u64" })]);
  }

  /**
   * Submit a caller-signed transaction XDR and poll until it lands.
   *
   * Resolves with the contract call's decoded return value (e.g. the new
   * circle id from `create_circle`), or `undefined` for calls that return
   * nothing, so callers don't need a follow-up read to learn the result.
   */
  async submitSignedTx<T = unknown>(signedXdr: string): Promise<T | undefined> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const sent = await sendWithRetry(this.server, tx);
    if (sent.status === "ERROR") {
      throw new AjoContractError(`Transaction rejected: ${JSON.stringify(sent.errorResult)}`);
    }

    const maxAttempts = 40; // ~60s at 1.5s/poll — a dropped tx should never hang the caller forever
    let result = await this.server.getTransaction(sent.hash);
    for (let attempt = 0; result.status === "NOT_FOUND" && attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await this.server.getTransaction(sent.hash);
    }
    if (result.status === "NOT_FOUND") {
      throw new AjoContractError(`Transaction ${sent.hash} was not found on-chain after ${maxAttempts} polls — it may have been dropped.`);
    }
    if (result.status !== "SUCCESS") {
      throw new AjoContractError(`Transaction failed: ${JSON.stringify(result)}`);
    }
    return decodeReturnValue<T>(result.returnValue);
  }

  private async readCall<T>(method: string, args: xdr.ScVal[]): Promise<T> {
    const account = new Account(Keypair.random().publicKey(), "0");
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw AjoContractError.fromSimulationError(sim.error);
    }
    return scValToNative(sim.result!.retval) as T;
  }

  private async buildTx(sourcePublicKey: string, method: string, args: xdr.ScVal[]): Promise<string> {
    const account = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw AjoContractError.fromSimulationError(sim.error);
    }
    return rpc.assembleTransaction(tx, sim).build().toXDR();
  }
}

/** Extracts the lower bound from a Soroban RPC "startLedger must be within the ledger range: X - Y" error. */
export function minLedgerFromRangeError(err: unknown): number | null {
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const match = /ledger range:\s*(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}