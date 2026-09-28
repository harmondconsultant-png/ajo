// Format test tests.
import { describe, expect, it } from "vitest";
import {
  assetLabel,
  clampDecimals,
  formatCycleLength,
  formatDeadline,
  formatXlm,
  isValidAmount,
  shortenAddress,
  xlmToStroops,
} from "./format";

describe("formatXlm", () => {
  it("formats a whole number of stroops with no decimal point", () => {
    expect(formatXlm(100_000_000n)).toBe("10");
  });

  it("formats a fractional amount, stripping trailing zeros", () => {
    expect(formatXlm(15_000_000n)).toBe("1.5");
    expect(formatXlm(10_000_001n)).toBe("1.0000001");
  });

  it("formats zero", () => {
    expect(formatXlm(0n)).toBe("0");
  });
});

describe("xlmToStroops", () => {
  it("converts a whole number string", () => {
    expect(xlmToStroops("10")).toBe(100_000_000n);
  });

  it("converts a fractional string", () => {
    expect(xlmToStroops("1.5")).toBe(15_000_000n);
  });

  it("round-trips through formatXlm", () => {
    expect(formatXlm(xlmToStroops("3.25"))).toBe("3.25");
  });

  it("truncates precision beyond 7 decimal places instead of rounding", () => {
    expect(xlmToStroops("1.123456789")).toBe(11_234_567n);
  });

  it("treats a bare decimal point as zero", () => {
    expect(xlmToStroops(".")).toBe(0n);
  });
});

describe("clampDecimals (#54)", () => {
  it("leaves values within the asset's precision untouched", () => {
    expect(clampDecimals("10")).toBe("10");
    expect(clampDecimals("1.5")).toBe("1.5");
    expect(clampDecimals("1.1234567")).toBe("1.1234567");
    expect(clampDecimals("1.")).toBe("1.");
    expect(clampDecimals("")).toBe("");
  });

  it("truncates excess fractional digits to 7 places by default", () => {
    expect(clampDecimals("1.123456789")).toBe("1.1234567");
    expect(clampDecimals("0.00000009")).toBe("0.0000000");
  });

  it("honours a custom precision", () => {
    expect(clampDecimals("1.239", 2)).toBe("1.23");
    expect(clampDecimals("1.9", 0)).toBe("1");
  });

  it("agrees with xlmToStroops so nothing is lost on submission", () => {
    const typed = "3.141592653";
    expect(xlmToStroops(clampDecimals(typed))).toBe(xlmToStroops(typed));
    expect(formatXlm(xlmToStroops(clampDecimals(typed)))).toBe(clampDecimals(typed));
  });
});

describe("isValidAmount (#54)", () => {
  it("accepts positive amounts within 7 decimal places", () => {
    expect(isValidAmount("10")).toBe(true);
    expect(isValidAmount("0.0000001")).toBe(true);
    expect(isValidAmount(".5")).toBe(true);
  });

  it("rejects amounts finer than the asset supports", () => {
    expect(isValidAmount("0.00000001")).toBe(false);
    expect(isValidAmount("1.12345678")).toBe(false);
  });

  it("rejects zero, empty, signed and exponent input", () => {
    expect(isValidAmount("0")).toBe(false);
    expect(isValidAmount("0.0000000")).toBe(false);
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount(".")).toBe(false);
    expect(isValidAmount("-1")).toBe(false);
    expect(isValidAmount("1e-8")).toBe(false);
  });
});

describe("assetLabel", () => {
  const nativeTokenId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const otherToken = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

  it("labels the native token as XLM", () => {
    expect(assetLabel(nativeTokenId, nativeTokenId)).toBe("XLM");
  });

  it("shortens a non-native token's contract address", () => {
    expect(assetLabel(otherToken, nativeTokenId)).toBe(shortenAddress(otherToken, 5));
  });
});

describe("shortenAddress", () => {
  const address = "GBWKRNCK4MZIEV37WIXN7W2CTBOEKAJNE5GEVAPIZ6Z3ED7RVB6SR57E";

  it("shortens a full Stellar address to a prefix…suffix", () => {
    expect(shortenAddress(address)).toBe("GBWK…R57E");
  });

  it("leaves a short string unchanged", () => {
    expect(shortenAddress("abc")).toBe("abc");
  });
});

describe("formatCycleLength", () => {
  it("labels one week as weekly", () => {
    expect(formatCycleLength(604_800n)).toBe("weekly");
  });

  it("labels multiple weeks", () => {
    expect(formatCycleLength(1_209_600n)).toBe("every 2 weeks");
  });

  it("labels one day as daily", () => {
    expect(formatCycleLength(86_400n)).toBe("daily");
  });

  it("falls back to raw seconds for an odd cycle length", () => {
    expect(formatCycleLength(3_661n)).toBe("every 3661s");
  });
});

describe("formatDeadline", () => {
  it("reports a passed deadline", () => {
    expect(formatDeadline(Date.now() / 1000 - 10)).toBe("deadline passed");
  });

  it("reports days remaining", () => {
    expect(formatDeadline(Date.now() / 1000 + 2 * 86_400 + 3_600)).toBe("2d 1h left");
  });

  it("reports minutes remaining when under an hour", () => {
    expect(formatDeadline(Date.now() / 1000 + 5 * 60)).toBe("5m left");
  });
});