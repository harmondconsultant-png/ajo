# @ajo/sdk

A thin, non-custodial TypeScript client for the Ajo rotating-savings-circle
contract on Stellar/Soroban — the same logic that backs `frontend/`,
packaged for any app that wants to integrate with Ajo circles directly.

This client never holds or requests a private key. Every state-changing
method returns an **unsigned transaction XDR string** — you sign it with
whatever wallet you control (Freighter, a server-side `Keypair`, a hardware
signer, anything that can sign a Stellar transaction) and pass the result
to `submitSignedTx`. Read methods need no signer at all.

## Install

```bash
npm install @ajo/sdk
```

## Usage

```ts
import { AjoClient, CircleStatus } from "@ajo/sdk";

const ajo = new AjoClient({
  contractId: "CCL4M6UACHON7VFUBIXCLY5OGD2HLGAYV63W54MKFJ3UICWCHEBYBWTL",
  rpcUrl: "https://soroban-testnet.stellar.org", // optional: custom RPC endpoint (defaults to testnet)
  networkPassphrase: "Test SDF Network ; September 2015", // optional: network passphrase
});

// Reads need no wallet.
const circle = await ajo.getCircle(1n);
console.log(circle.status === CircleStatus.Active);

const openCircleIds = await ajo.discoverCircleIds(); // reads the contract's own event log

// Writes: build unsigned XDR, sign it yourself, submit it.
// buildContributeTx accepts an optional memo (string or Memo object) for tracking.
const unsignedXdr = await ajo.buildContributeTx(circleId, memberPublicKey, "cycle-1-payment");
const signedXdr = await yourWallet.sign(unsignedXdr); // however your app signs
await ajo.submitSignedTx(signedXdr);
```

## API

| Method | Signer required | What it does |
|---|---|---|
| `getCircle(id)` | No | Full circle state (throws typed `AjoContractError` if not found) |
| `hasContributed(id, cycle, member)` | No | Whether a member has paid the given cycle |
| `missedCount(id, member)` | No | A member's missed-deadline strike count |
| `totalCircles()` | No | Running count of circles ever created |
| `discoverCircleIds()` | No | Circle ids from the contract's `(circle, created)` event log |
| `buildCreateCircleTx(...)` | Yes (returns unsigned XDR) | Start a circle |
| `buildJoinCircleTx(id, member)` | Yes | Join a forming circle |
| `buildLeaveCircleTx(id, member)` | Yes | Leave a forming circle |
| `buildCancelCircleTx(id, creator)` | Yes | Creator cancels a forming circle |
| `buildContributeTx(id, member, memo?)` | Yes | Pay the current cycle's contribution (supports custom memo) |
| `buildDisburseTx(id, caller)` | Yes | Pay out the current cycle (callable by anyone) |
| `submitSignedTx(signedXdr)` | — | Submit a caller-signed transaction and wait for it to land |

See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for why the whole
project is built this way — no backend, no custody, reads straight off the
event log.
