// Format.
const STROOPS_PER_XLM = 10_000_000n;

/**
 * Decimal places supported by circle assets. Native XLM and every Stellar
 * Asset Contract token use 7 (one stroop), and xlmToStroops scales by 7 —
 * anything finer would be silently truncated on submission.
 */
export const ASSET_DECIMALS = 7;

export function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.trim().split(".");
  const paddedFrac = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt(paddedFrac || "0");
}

/**
 * Clamp a user-typed decimal amount to at most `decimals` fractional digits,
 * so the input never shows more precision than the asset can hold.
 * Truncates (never rounds up) to match xlmToStroops.
 */
export function clampDecimals(value: string, decimals = ASSET_DECIMALS): string {
  const dot = value.indexOf(".");
  if (dot === -1) return value;
  const frac = value.slice(dot + 1);
  if (frac.length <= decimals) return value;
  return decimals === 0 ? value.slice(0, dot) : value.slice(0, dot + 1 + decimals);
}

/** True for a plain positive decimal string within the asset's precision (no exponents, signs or excess digits). */
export function isValidAmount(value: string, decimals = ASSET_DECIMALS): boolean {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[1] === "" && !match[2])) return false;
  if ((match[2] ?? "").length > decimals) return false;
  return xlmToStroops(value) > 0n;
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** "XLM" for the native asset, otherwise a shortened contract address — circles aren't native-only. */
export function assetLabel(token: string, nativeTokenId: string): string {
  return token === nativeTokenId ? "XLM" : shortenAddress(token, 5);
}

export function formatCycleLength(seconds: bigint): string {
  const s = Number(seconds);
  if (s % 604_800 === 0) {
    const weeks = s / 604_800;
    return weeks === 1 ? "weekly" : `every ${weeks} weeks`;
  }
  if (s % 86_400 === 0) {
    const days = s / 86_400;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  return `every ${s}s`;
}

export function formatDeadline(deadlineSecs: number): string {
  const now = Date.now() / 1000;
  const diff = deadlineSecs - now;
  if (diff <= 0) return "deadline passed";

  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h left`;
  const minutes = Math.floor((diff % 3_600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}