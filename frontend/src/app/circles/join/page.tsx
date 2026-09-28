"use client";
// Join page — resolves an invite link (`/circles/join?id=<id>`) to its circle.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Card } from "@/components/ui";
import { CircleNotFound } from "@/components/circle-not-found";
import { CircleDetailSkeleton } from "../[id]/circle-detail-skeleton";
import { ContractCallError, getCircle } from "@/lib/contract";
import { ContractErrorCode } from "@/lib/contract-errors";
import { parseCircleId } from "@/lib/circle-id";

export default function JoinCirclePage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          <Suspense fallback={<CircleDetailSkeleton />}>
            <JoinCircleResolver />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}

function JoinCircleResolver() {
  const router = useRouter();
  const rawId = useSearchParams().get("id");
  const circleId = parseCircleId(rawId);

  // Validate before rendering anything circle-specific: a malformed id is
  // rejected immediately, a well-formed one is checked against the contract.
  const [state, setState] = useState<"checking" | "not-found" | { error: string }>(
    circleId === null ? "not-found" : "checking",
  );

  useEffect(() => {
    document.title = state === "not-found" ? "Circle not found · Ajo" : "Join a circle · Ajo";
  }, [state]);

  useEffect(() => {
    if (circleId === null) return;
    let cancelled = false;
    getCircle(circleId)
      .then(() => {
        if (!cancelled) router.replace(`/circles/${circleId}`);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ContractCallError && err.code === ContractErrorCode.CircleNotFound) {
          setState("not-found");
        } else {
          setState({ error: err instanceof Error ? err.message : "Could not load this circle." });
        }
      });
    return () => {
      cancelled = true;
    };
    // circleId is a bigint derived from rawId each render; key the effect on the string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawId, router]);

  if (state === "not-found") return <CircleNotFound rawId={rawId} />;
  if (state === "checking") return <CircleDetailSkeleton />;
  return (
    <Card className="p-6 text-sm text-accent-rose" role="alert">
      {state.error}
    </Card>
  );
}
