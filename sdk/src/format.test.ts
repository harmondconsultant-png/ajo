import { describe, expect, it } from "vitest";
import { formatXlm, parseAmount, xlmToStroops } from "./format";

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

describe("parseAmount (#67)", () => {
  it("parses valid integer and decimal numbers", () => {
    expect(parseAmount("100")).toBe(100);
    expect(parseAmount("12.34")).toBe(12.34);
    expect(parseAmount("0.5")).toBe(0.5);
  });

  it("throws on non-numeric strings instead of returning NaN", () => {
    expect(() => parseAmount("abc")).toThrow('Invalid numeric amount: "abc"');
    expect(() => parseAmount("")).toThrow("Invalid numeric amount");
    expect(() => parseAmount("12.34.56")).toThrow("Invalid numeric amount");
    expect(() => parseAmount("100xyz")).toThrow("Invalid numeric amount");
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

  it("rejects non-numeric strings", () => {
    expect(() => xlmToStroops("abc")).toThrow('Invalid XLM amount: "abc"');
    expect(() => xlmToStroops("12.34.56")).toThrow("Invalid XLM amount");
  });
});
