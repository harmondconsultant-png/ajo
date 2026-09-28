// Circle not found state.
import Link from "next/link";
import { Card } from "@/components/ui";

/** Shown when an invite link or circle URL points at an id that's malformed or doesn't exist on-chain. */
export function CircleNotFound({ rawId }: { rawId: string | null }) {
  return (
    <Card className="flex flex-col items-center p-10 text-center" role="alert">
      <p className="eyebrow">Circle not found</p>
      <h1 className="font-display mt-3 text-2xl italic tracking-tight">This circle doesn&apos;t exist.</h1>
      <p className="mt-3 max-w-sm text-sm text-muted">
        {rawId
          ? `We couldn't find a circle with id "${rawId}". Double-check the invite link with whoever shared it.`
          : "This invite link is missing a circle id. Double-check the link with whoever shared it."}
      </p>
      <Link
        href="/circles"
        className="mt-8 rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background hover:opacity-85"
      >
        Browse circles
      </Link>
    </Card>
  );
}
