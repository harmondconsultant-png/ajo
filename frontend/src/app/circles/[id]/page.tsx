"use client";
// [id] page.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle as CircleIcon, AlertTriangle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button, Card, Badge, CopyButton } from "@/components/ui";
import { CircleNotFound } from "@/components/circle-not-found";
import { CircleDetailSkeleton } from "./circle-detail-skeleton";
import { useWallet } from "@/context/wallet-context";
import {
  Circle,
  CircleStatus,
  ContractCallError,
  NATIVE_TOKEN_ID,
  buildCancelCircleTx,
  buildContributeTx,
  buildDisburseTx,
  buildJoinCircleTx,
  buildLeaveCircleTx,
  getCircle,
  hasContributed,
  missedCount,
  submitSignedTx,
} from "@/lib/contract";
import { assetLabel, formatCycleLength, formatDeadline, formatXlm, shortenAddress } from "@/lib/format";
import { rememberCircleId } from "@/lib/circle-cache";
import { parseCircleId } from "@/lib/circle-id";
import { ContractErrorCode } from "@/lib/contract-errors";
import { WalletError } from "@/lib/wallet";
import { hasContributedCached, missedCountCached, invalidateCircleCache } from "@/lib/rpc-cache";
import { paginate } from "@/lib/paginate";

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

/** Members shown per page in the payout-order list (#58). */
const MEMBERS_PAGE_SIZE = 10;

interface MemberRow {
  address: string;
  paidThisCycle: boolean;
  strikes: number;
}

export default function CircleDetailPage() {
  const params = useParams<{ id: string }>();
  const circleId = parseCircleId(params.id);
  const { address, connectWallet, signTransaction } = useWallet();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [notFound, setNotFound] = useState(circleId === null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"join" | "contribute" | "disburse" | "leave" | "cancel" | null>(null);

  useEffect(() => {
    document.title = circleId !== null && !notFound ? `Circle #${circleId} · Ajo` : "Circle not found · Ajo";
  }, [circleId, notFound]);

  const refresh = useCallback(async () => {
    if (circleId === null) return;
    try {
      const loaded = await getCircle(circleId);
      setCircle(loaded);
      rememberCircleId(circleId);

      // Batch RPC calls with memoization to reduce round trips (#119)
      // Use caching layer to avoid redundant RPC calls across refreshes
      const contributionPromises: Promise<boolean>[] = [];
      const missedPromises: Promise<number>[] = [];

      // Fetch all contribution statuses in parallel (if circle is active)
      if (loaded.status === CircleStatus.Active) {
        for (const m of loaded.members) {
          contributionPromises.push(
            hasContributedCached(hasContributed, circleId, loaded.currentCycle, m),
          );
        }
      }

      // Fetch all missed counts in parallel
      for (const m of loaded.members) {
        missedPromises.push(missedCountCached(missedCount, circleId, m));
      }

      // Wait for all RPC calls to complete
      const contributions = await Promise.all(contributionPromises);
      const missed = await Promise.all(missedPromises);

      // Build member rows from fetched results
      const rows: MemberRow[] = loaded.members.map((m, i) => ({
        address: m,
        paidThisCycle: loaded.status === CircleStatus.Active ? contributions[i] ?? false : false,
        strikes: missed[i] ?? 0,
      }));

      setMembers(rows);
    } catch (err) {
      if (err instanceof ContractCallError && err.code === ContractErrorCode.CircleNotFound) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not load this circle.");
      }
    }
  }, [circleId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount, not derived state
    void refresh();
  }, [refresh]);

  async function ensureWallet(): Promise<string> {
    if (address) return address;
    return connectWallet();
  }

  async function handleJoin() {
    if (circleId === null) return;
    setBusy("join");
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildJoinCircleTx(circleId, wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Joined circle");
      invalidateCircleCache(circleId); // Clear cache after mutation (#119)
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not join circle."));
    } finally {
      setBusy(null);
    }
  }

  async function handleContribute() {
    if (circleId === null) return;
    setBusy("contribute");
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildContributeTx(circleId, wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Contribution sent");
      invalidateCircleCache(circleId); // Clear cache after mutation (#119)
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not contribute."));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisburse() {
    if (circleId === null) return;
    setBusy("disburse");
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildDisburseTx(circleId, wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Payout sent");
      invalidateCircleCache(circleId); // Clear cache after mutation (#119)
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Not ready to pay out yet — every member must contribute, or the deadline must pass."));
    } finally {
      setBusy(null);
    }
  }

  async function handleLeave() {
    if (circleId === null) return;
    setBusy("leave");
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildLeaveCircleTx(circleId, wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Left circle");
      invalidateCircleCache(circleId); // Clear cache after mutation (#119)
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not leave circle."));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (circleId === null) return;
    if (!window.confirm("Cancel this circle? It can't be undone, and no one will be able to join it again.")) {
      return;
    }
    setBusy("cancel");
    try {
      const wallet = await ensureWallet();
      const unsignedXdr = await buildCancelCircleTx(circleId, wallet);
      const signedXdr = await signTransaction(unsignedXdr);
      await submitSignedTx(signedXdr);
      toast.success("Circle cancelled");
      invalidateCircleCache(circleId); // Clear cache after mutation (#119)
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel circle."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          {notFound ? (
            <CircleNotFound rawId={params.id} />
          ) : error ? (
            <Card className="p-6 text-sm text-accent-rose" role="alert">
              {error}
            </Card>
          ) : !circle || !members ? (
            <CircleDetailSkeleton />
          ) : (
            <CircleDetail
              circle={circle}
              members={members}
              address={address}
              busy={busy}
              onJoin={handleJoin}
              onContribute={handleContribute}
              onDisburse={handleDisburse}
              onLeave={handleLeave}
              onCancel={handleCancel}
            />
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

function CircleDetail({
  circle,
  members,
  address,
  busy,
  onJoin,
  onContribute,
  onDisburse,
  onLeave,
  onCancel,
}: {
  circle: Circle;
  members: MemberRow[];
  address: string | null;
  busy: "join" | "contribute" | "disburse" | "leave" | "cancel" | null;
  onJoin: () => void;
  onContribute: () => void;
  onDisburse: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  const isMember = address ? circle.members.includes(address) : false;
  const isCreator = address === circle.creator;
  const myRow = members.find((m) => m.address === address);
  const [memberPage, setMemberPage] = useState(1);
  const memberPageView = paginate(members, memberPage, MEMBERS_PAGE_SIZE);
  const recipient =
    circle.status !== CircleStatus.Completed && circle.currentCycle < circle.members.length
      ? circle.members[circle.currentCycle]
      : null;
  const deadline =
    circle.status === CircleStatus.Active
      ? Number(circle.startedAt) + (circle.currentCycle + 1) * Number(circle.cycleLengthSecs)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Circle #{circle.id.toString()}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {formatXlm(circle.contributionAmount)} {assetLabel(circle.token, NATIVE_TOKEN_ID)} &middot;{" "}
            {formatCycleLength(circle.cycleLengthSecs)}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <CopyButton value={window.location.href} label="Copy invite link" />
          <Badge tone={STATUS_TONE[circle.status]}>{STATUS_LABEL[circle.status]}</Badge>
        </div>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Members</p>
            <p className="mt-1 font-medium">
              {circle.members.length}/{circle.maxMembers}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Cycle</p>
            <p className="mt-1 font-medium">
              {circle.status === CircleStatus.Completed ? "Done" : `${circle.currentCycle + 1} of ${circle.maxMembers}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">This cycle&apos;s payout</p>
            <p className="mt-1 truncate font-medium">{recipient ? shortenAddress(recipient) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Deadline</p>
            <p className="mt-1 font-medium">{deadline ? formatDeadline(deadline) : "—"}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {circle.status === CircleStatus.Forming && !isMember && (
            <Button onClick={onJoin} disabled={busy !== null}>
              {busy === "join" ? "Joining…" : "Join this circle"}
            </Button>
          )}
          {circle.status === CircleStatus.Forming && isMember && (
            <Button variant="outline" onClick={onLeave} disabled={busy !== null}>
              {busy === "leave" ? "Leaving…" : "Leave circle"}
            </Button>
          )}
          {circle.status === CircleStatus.Forming && isCreator && (
            <Button variant="danger" onClick={onCancel} disabled={busy !== null}>
              {busy === "cancel" ? "Cancelling…" : "Cancel circle"}
            </Button>
          )}
          {circle.status === CircleStatus.Active && isMember && !myRow?.paidThisCycle && (
            <Button onClick={onContribute} disabled={busy !== null}>
              {busy === "contribute"
                ? "Contributing…"
                : `Contribute ${formatXlm(circle.contributionAmount)} ${assetLabel(circle.token, NATIVE_TOKEN_ID)}`}
            </Button>
          )}
          {circle.status === CircleStatus.Active && (
            <Button variant="outline" onClick={onDisburse} disabled={busy !== null}>
              {busy === "disburse" ? "Paying out…" : "Trigger payout"}
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="eyebrow">Members &middot; payout order</h2>
        </div>
        <ul className="divide-y divide-border">
          {memberPageView.items.map((m, pageIndex) => {
            const index = memberPageView.offset + pageIndex;
            return (
              <li key={m.address} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-medium text-muted">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{shortenAddress(m.address, 6)}</p>
                    {m.address === address && <p className="text-xs accent-text">You</p>}
                  </div>
                  <CopyButton value={m.address} label="" className="shrink-0" />
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-10 sm:flex-nowrap sm:gap-3 sm:pl-0">
                  {m.strikes > 0 && (
                    <span className="flex items-center gap-1 text-xs text-accent-rose">
                      <AlertTriangle size={13} />
                      {m.strikes} missed
                    </span>
                  )}
                  {circle.status === CircleStatus.Active &&
                    (m.paidThisCycle ? (
                      <span className="flex items-center gap-1 text-xs text-accent-green">
                        <CheckCircle2 size={14} />
                        Paid this cycle
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <CircleIcon size={14} />
                        Waiting
                      </span>
                    ))}
                  {index === circle.currentCycle && circle.status !== CircleStatus.Completed && (
                    <Badge tone="gold">Next payout</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {memberPageView.totalPages > 1 && (
          <nav
            aria-label="Members pagination"
            className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-xs text-muted"
          >
            <span>
              {memberPageView.offset + 1}–{memberPageView.offset + memberPageView.items.length} of {members.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMemberPage(memberPageView.page - 1)}
                disabled={memberPageView.page <= 1}
              >
                Previous
              </Button>
              <span aria-live="polite">
                Page {memberPageView.page} of {memberPageView.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMemberPage(memberPageView.page + 1)}
                disabled={memberPageView.page >= memberPageView.totalPages}
              >
                Next
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof WalletError || err instanceof ContractCallError) return err.message;
  return fallback;
}