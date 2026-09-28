// XLM <-> stroop conversion, shared by the CLI and frontend (#107).
export const STROOPS_PER_XLM = 10_000_000n;

/** Format a stroop amount as XLM, trimming trailing zeros ("15000000" -> "1.5"). */
export function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Parse an amount string into a number, throwing on non-numeric or invalid strings (#67)
 * instead of silently returning NaN.
 */
export function parseAmount(amount: string): number {
  const trimmed = amount.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid numeric amount: "${amount}"`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric amount: "${amount}"`);
  }
  return parsed;
}

/** Parse a decimal XLM string into stroops, truncating past 7 decimal places. */
export function xlmToStroops(xlm: string): bigint {
  const trimmed = xlm.trim();
  if (trimmed === "." || trimmed === "") return 0n;
  if (!/^\d*(\.\d*)?$/.test(trimmed)) {
    throw new Error(`Invalid XLM amount: "${xlm}"`);
  }
  const [whole = "", frac = ""] = trimmed.split(".");
  const paddedFrac = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt(paddedFrac || "0");
}
