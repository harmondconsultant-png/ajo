import { describe, expect, it, vi } from "vitest";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  AjoClient,
  AjoContractError,
  CircleStatus,
  decodeReturnValue,
  minLedgerFromRangeError,
  sendWithRetry,
} from "./client";

describe("AjoContractError", () => {
  it("is a real Error subclass with a stable name for narrowing", () => {
    const error = new AjoContractError("simulation failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AjoContractError");
    expect(error.message).toBe("simulation failed");
  });
});

describe("CircleStatus", () => {
  it("matches the contract's discriminant values exactly", () => {
    // These are load-bearing: scValToNative decodes the contract's enum to
    // a plain number, and callers compare it against this enum by value.
    // A mismatch here would silently misclassify every circle's status.
    expect(CircleStatus.Forming).toBe(0);
    expect(CircleStatus.Active).toBe(1);
    expect(CircleStatus.Completed).toBe(2);
    expect(CircleStatus.Cancelled).toBe(3);
  });
});

describe("minLedgerFromRangeError", () => {
  it("extracts the lower bound from a real Soroban RPC range error", () => {
    const err = { code: -32600, message: "startLedger must be within the ledger range: 3846337 - 3967296" };
    expect(minLedgerFromRangeError(err)).toBe(3846337);
  });

  it("returns null for an unrelated error", () => {
    expect(minLedgerFromRangeError(new Error("network timeout"))).toBeNull();
  });

  it("handles a plain string error", () => {
    expect(minLedgerFromRangeError("ledger range: 100 - 200")).toBe(100);
  });
});

describe("AjoClient", () => {
  it("constructs with just a contract id, defaulting to testnet", () => {
    expect(() => new AjoClient({ contractId: "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL" })).not.toThrow();
  });

  it("accepts a custom rpc url and network passphrase", () => {
    const client = new AjoClient({
      contractId: "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL",
      rpcUrl: "https://soroban-mainnet.example.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(client).toBeInstanceOf(AjoClient);
  });

  it("throws AjoContractError with CircleNotFound when getCircle receives a missing circle", async () => {
    const client = new AjoClient({
      contractId: "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL",
    });
    // Stub simulateTransaction to return a simulation error with Error(Contract, #1)
    vi.spyOn(client.server, "simulateTransaction").mockResolvedValue({
      error: "HostError: Error(Contract, #1)",
    } as any);

    await expect(client.getCircle(999n)).rejects.toThrow("That circle doesn't exist.");
  });

  it("buildContributeTx supports custom memo string and Memo instances", async () => {
    const client = new AjoClient({
      contractId: "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL",
    });
    const testKp = Keypair.random();
    vi.spyOn(client.server, "getAccount").mockResolvedValue({
      sequenceNumber: () => "100",
      incrementSequenceNumber: () => {},
      accountId: () => testKp.publicKey(),
    } as any);
    vi.spyOn(client.server, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvVoid() },
      minResourceFee: "100",
      transactionData: new xdr.SorobanTransactionData({
        ext: new xdr.ExtensionPoint(0),
        resources: new xdr.SorobanResources({
          footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
          instructions: 100,
          readBytes: 100,
          writeBytes: 100,
        }),
        resourceFee: new xdr.Int64(100n),
      }),
    } as any);

    const xdrWithMemo = await client.buildContributeTx(
      1n,
      testKp.publicKey(),
      "cycle-1-contribution",
    );
    expect(typeof xdrWithMemo).toBe("string");
    expect(xdrWithMemo.length).toBeGreaterThan(0);
  });
});
describe("sendWithRetry (#150)", () => {
  function mockServer(sendTransaction: (...args: unknown[]) => unknown) {
    return { sendTransaction } as unknown as Parameters<typeof sendWithRetry>[0];
  }

  it("returns immediately on PENDING without retrying", async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: "PENDING", hash: "abc" });
    const result = await sendWithRetry(mockServer(sendTransaction), {} as never);
    expect(result.status).toBe("PENDING");
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns DUPLICATE as-is without retrying, so the caller proceeds to polling", async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: "DUPLICATE", hash: "abc" });
    const result = await sendWithRetry(mockServer(sendTransaction), {} as never);
    expect(result.status).toBe("DUPLICATE");
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns ERROR as-is without retrying", async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: "ERROR", hash: "abc" });
    const result = await sendWithRetry(mockServer(sendTransaction), {} as never);
    expect(result.status).toBe("ERROR");
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff on TRY_AGAIN_LATER, then returns the eventual success", async () => {
    vi.useFakeTimers();
    try {
      const sendTransaction = vi
        .fn()
        .mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: "abc" })
        .mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: "abc" })
        .mockResolvedValueOnce({ status: "PENDING", hash: "abc" });

      const promise = sendWithRetry(mockServer(sendTransaction), {} as never);
      // Two backoff delays (500ms, 1000ms) must elapse between the three calls.
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.status).toBe("PENDING");
      expect(sendTransaction).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries on transient network exceptions and recovers", async () => {
    vi.useFakeTimers();
    try {
      const sendTransaction = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({ status: "PENDING", hash: "abc" });

      const promise = sendWithRetry(mockServer(sendTransaction), {} as never);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result.status).toBe("PENDING");
      expect(sendTransaction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws the last error when all retry attempts fail due to network errors", async () => {
    vi.useFakeTimers();
    try {
      const sendTransaction = vi.fn().mockRejectedValue(new Error("Connection reset"));
      const promise = sendWithRetry(mockServer(sendTransaction), {} as never);
      const rejection = expect(promise).rejects.toThrow("Connection reset");
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
      expect(sendTransaction).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("decodeReturnValue", () => {
  it("decodes a u64 return value (e.g. create_circle's new id) to a bigint", () => {
    expect(decodeReturnValue<bigint>(nativeToScVal(42n, { type: "u64" }))).toBe(42n);
  });

  it("returns undefined when there is no return value", () => {
    expect(decodeReturnValue(undefined)).toBeUndefined();
  });

  it("returns undefined for a void return (e.g. join / contribute)", () => {
    expect(decodeReturnValue(xdr.ScVal.scvVoid())).toBeUndefined();
  });
});
