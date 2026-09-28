// Integration test suite simulating SDK build-sign-submit lifecycle on local sandbox (#65).
import { describe, expect, it, vi } from "vitest";
import { Keypair, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { AjoClient, CircleStatus } from "./client";

describe("SDK Local Network Sandbox Integration", () => {
  const contractId = "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL";
  const client = new AjoClient({
    contractId,
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
  });

  it("exercises complete build-sign-submit transaction lifecycle", async () => {
    const creatorKp = Keypair.random();
    const tokenKp = Keypair.random();

    vi.spyOn(client.server, "getAccount").mockResolvedValue({
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
      accountId: () => creatorKp.publicKey(),
    } as any);

    vi.spyOn(client.server, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvU64(new xdr.Uint64(1n)) },
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

    // 1. Build unsigned transaction
    const unsignedXdr = await client.buildCreateCircleTx(
      creatorKp.publicKey(),
      tokenKp.publicKey(),
      100_000_000n,
      3,
      86400n,
    );
    expect(typeof unsignedXdr).toBe("string");

    // 2. Sign transaction locally
    const tx = TransactionBuilder.fromXDR(unsignedXdr, "Standalone Network ; February 2017");
    tx.sign(creatorKp);
    const signedXdr = tx.toXDR();

    // 3. Mock submission and confirmation
    vi.spyOn(client.server, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "sandbox-tx-hash-001",
    } as any);

    vi.spyOn(client.server, "getTransaction").mockResolvedValue({
      status: "SUCCESS",
      returnValue: xdr.ScVal.scvU64(new xdr.Uint64(1n)),
    } as any);

    // 4. Submit and verify decoded response
    const newCircleId = await client.submitSignedTx<bigint>(signedXdr);
    expect(newCircleId).toBe(1n);
  });

  it("handles join and contribute flow in sandbox", async () => {
    const memberKp = Keypair.random();

    vi.spyOn(client.server, "getAccount").mockResolvedValue({
      sequenceNumber: () => "2",
      incrementSequenceNumber: () => {},
      accountId: () => memberKp.publicKey(),
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

    const joinXdr = await client.buildJoinCircleTx(1n, memberKp.publicKey());
    expect(typeof joinXdr).toBe("string");

    const contributeXdr = await client.buildContributeTx(1n, memberKp.publicKey(), "member-contrib");
    expect(typeof contributeXdr).toBe("string");
  });
});
