// Circle id.

/**
 * Circle ids come from untrusted places — route params, `?id=` on invite
 * links, pasted text — so only accept a non-negative integer that fits the
 * contract's `u64`.
 */
const U64_MAX = 2n ** 64n - 1n;

export function parseCircleId(raw: string | null | undefined): bigint | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id <= U64_MAX ? id : null;
}
