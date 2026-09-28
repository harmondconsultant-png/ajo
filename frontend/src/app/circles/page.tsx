"use client";
// Circles page.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { useWallet } from "@/context/wallet-context";
import {
  Circle,
  CircleStatus,
  NATIVE_TOKEN_ID,
  buildCreateCircleTx,
  buildJoinCircleTx,
  discoverCircleIds,
  getCircle,
  getTotalCircles,
  submitSignedTx,
} from "@/lib/contract";
import {
  ASSET_DECIMALS,
  assetLabel,
  clampDecimals,
  formatCycleLength,
  formatXlm,
  isValidAmount,
  shortenAddress,
  xlmToStroops,
} from "@/lib/format";
import { getKnownCircleIds, rememberCircleIds } from "@/lib/circle-cache";
import { WalletError } from "@/lib/wallet";
import { ContractCallError } from "@/lib/contract";

const CYCLE_OPTIONS = [
  { label: "Daily", secs: 86_400 },
  { label: "Weekly", secs: 604_800 },
  { label: "Every 2 weeks", secs: 1_209_600 },
  { label: "Monthly", secs: 2_592_000 },
];

const STATUS_TONE = {
  [CircleStatus.Forming]: "gold" as const,
  [CircleStatus.Active]: "green" as const,
  [CircleStatus.Completed]: "muted" as const,
  [CircleStatus.Cancelled]: "rose" as const,
};
const STATUS_LABEL = {
  [CircleStatus.Forming]: "Forming",
  [CircleStatus.Active]: "Active",
  [CircleStatus.Completed]: "Completed",
  [CircleStatus.Cancelled]: "Cancelled",
};

export default function CirclesPage() {
  const router = useRouter();
  const { address, connectWallet, connecting, signTransaction } = useWallet();

  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalCircles, setTotalCircles] = useState<bigint | null>(null);

  const [amount, setAmount] = useState("10");
  const [maxMembers, setMaxMembers] = useState("4");
  const [cycleSecs, setCycleSecs] = useState(String(CYCLE_OPTIONS[1].secs));
  const [tokenChoice, setTokenChoice] = useState<"native" | "custom">("native");
  const [customToken, setCustomToken] = useState("");
  const [creating, setCreating] = useState(false);

  const [joinId, setJoinId] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    document.title = "Circles · Ajo";
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [discovered, total] = await Promise.all([discoverCircleIds(), getTotalCircles()]);
      rememberCircleIds(discovered);

      const idSet = new Map<string, bigint>();
      for (const id of [...discovered, ...getKnownCircleIds()]) idSet.set(id.toString(), id);

      // Cached ids can predate a contract redeploy and no longer resolve —
      // load with allSettled so one stale id can't blank out the whole list.
      const results = await Promise.allSettled([...idSet.values()].map((id) => getCircle(id)));
      const loaded = results
        .filter((r): r is PromiseFulfilledResult<Circle> => r.status === "fulfilled")
        .map((r) => r.value)
        .sort((a, b) => (a.id < b.id ? 1 : -1));

      setCircles(loaded);
      setTotalCircles(total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load circles.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount, not derived state
    void refresh();
  }, [refresh]);

  async function ensureWallet(): Promise<string> {
    if (address) return address;
    return connectWallet();
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const token = tokenChoice === "native" ? NATIVE_TOKEN_ID : customToken.trim();
    if (tokenChoice === "custom" && !token) {
      toast.error("Enter the asset's contract address.");
      return;
    }
    if (!isValidAmount(amount)) {
      toast.error(`Enter a contribution greater than zero, with at most ${ASSET_DECIMALS} decimal places.`);
      return;
    }
    setCreating(true);
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildCreateCircleTx(
        wallet,
        token,
        xlmToStroops(amount),
        Number(maxMembers),
        BigInt(cycleSecs),
      );
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Circle created");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not create circle."));
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (!joinId.trim()) return;
    setJoining(true);
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildJoinCircleTx(BigInt(joinId), wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      rememberCircleIds([BigInt(joinId)]);
      toast.success("Joined circle");
      router.push(`/circles/${joinId}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not join circle."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Circles</p>
              <h1 className="font-display mt-2 text-3xl italic tracking-tight">Start or join a circle</h1>
            </div>
            {totalCircles !== null && (
              <Badge tone="gold">{totalCircles.toString()} circles created on testnet</Badge>
            )}
          </div>
          <p className="mt-2 max-w-lg text-sm text-muted">
            Circles run on Stellar testnet, in native XLM or any Stellar Asset Contract token. Connect a wallet when
            you&apos;re ready to create, join, or contribute.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="eyebrow">New circle</h2>
              <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3">
                <label className="text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Asset</span>
                  <select
                    value={tokenChoice}
                    onChange={(e) => setTokenChoice(e.target.value as "native" | "custom")}
                    className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value="native">Native XLM</option>
                    <option value="custom">Custom Stellar Asset Contract</option>
                  </select>
                </label>
                {tokenChoice === "custom" && (
                  <label className="text-sm">
                    <span className="mb-1.5 block text-xs text-muted">Asset contract address</span>
                    <input
                      required
                      placeholder="C…"
                      value={customToken}
                      onChange={(e) => setCustomToken(e.target.value)}
                      className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                )}
                <label className="text-sm">
                  <span className="mb-1.5 block text-xs text-muted">
                    Contribution per member{" "}
                    {tokenChoice === "native" ? "(XLM)" : `(token units, up to ${ASSET_DECIMALS} decimal places)`}
                  </span>
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.0000001"
                    step="0.0000001"
                    value={amount}
                    onChange={(e) => setAmount(clampDecimals(e.target.value))}
                    className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Members</span>
                  <input
                    required
                    type="number"
                    min="2"
                    max="50"
                    value={maxMembers}
                    onChange={(e) => setMaxMembers(e.target.value)}
                    className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Cycle length</span>
                  <select
                    value={cycleSecs}
                    onChange={(e) => setCycleSecs(e.target.value)}
                    className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
                  >
                    {CYCLE_OPTIONS.map((opt) => (
                      <option key={opt.secs} value={opt.secs}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={creating || connecting} className="mt-2">
                  {creating ? "Creating…" : address ? "Create circle" : "Connect wallet & create"}
                </Button>
              </form>
            </Card>

            <Card className="p-6">
              <h2 className="eyebrow">Join by circle ID</h2>
              <p className="mt-2 text-sm text-muted">
                Someone shared a circle ID with you? Enter it here to join directly.
              </p>
              <form onSubmit={handleJoin} className="mt-4 flex flex-col gap-3">
                <input
                  required
                  type="number"
                  min="1"
                  placeholder="e.g. 1"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  className="w-full rounded-xl border border-border-strong bg-background px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
                />
                <Button type="submit" variant="outline" disabled={joining || connecting}>
                  {joining ? "Joining…" : "Join circle"}
                </Button>
              </form>
            </Card>
          </div>

          <div className="mt-16">
            <h2 className="eyebrow">Recent circles</h2>
            <div className="mt-4">
              {loadError ? (
                <Card className="p-6 text-sm text-accent-rose" role="alert">
                  {loadError}
                </Card>
              ) : circles === null ? (
                <div
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  role="status"
                  aria-label="Loading circles"
                >
                  {[0, 1, 2].map((i) => (
                    <Card key={i} className="h-[136px] animate-pulse p-5" aria-hidden="true">
                      <div className="h-3 w-20 rounded-full bg-border" />
                      <div className="mt-4 h-5 w-24 rounded-full bg-border" />
                      <div className="mt-2 h-3 w-16 rounded-full bg-border" />
                    </Card>
                  ))}
                </div>
              ) : circles.length === 0 ? (
                <Card>
                  <EmptyState>No circles yet. Start the first one above.</EmptyState>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {circles.map((circle) => (
                    <a key={circle.id.toString()} href={`/circles/${circle.id}`}>
                      <Card className="h-full p-5 transition-shadow hover:shadow-md">
                        <div className="flex items-center justify-between">
                          <span className="eyebrow">Circle #{circle.id.toString()}</span>
                          <Badge tone={STATUS_TONE[circle.status]}>{STATUS_LABEL[circle.status]}</Badge>
                        </div>
                        <p className="mt-3 text-lg font-semibold">
                          {formatXlm(circle.contributionAmount)} {assetLabel(circle.token, NATIVE_TOKEN_ID)}
                        </p>
                        <p className="text-xs text-muted">{formatCycleLength(circle.cycleLengthSecs)}</p>
                        <div className="mt-4 flex items-center justify-between text-xs text-muted">
                          <span>
                            {circle.members.length}/{circle.maxMembers} members
                          </span>
                          <span>by {shortenAddress(circle.creator)}</span>
                        </div>
                      </Card>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof WalletError || err instanceof ContractCallError) return err.message;
  return fallback;
}