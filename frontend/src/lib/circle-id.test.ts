// Circle id tests.
import { describe, expect, it } from "vitest";
import { parseCircleId } from "./circle-id";

describe("parseCircleId", () => {
  it("parses a plain integer", () => {
    expect(parseCircleId("42")).toBe(42n);
    expect(parseCircleId("0")).toBe(0n);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseCircleId(" 7 ")).toBe(7n);
  });

  it("rejects missing, empty, and malformed ids", () => {
    expect(parseCircleId(null)).toBeNull();
    expect(parseCircleId(undefined)).toBeNull();
    expect(parseCircleId("")).toBeNull();
    expect(parseCircleId("join")).toBeNull();
    expect(parseCircleId("-1")).toBeNull();
    expect(parseCircleId("1.5")).toBeNull();
    expect(parseCircleId("1e3")).toBeNull();
    expect(parseCircleId("0x10")).toBeNull();
  });

  it("rejects ids that overflow u64", () => {
    expect(parseCircleId("18446744073709551615")).toBe(18446744073709551615n);
    expect(parseCircleId("18446744073709551616")).toBeNull();
  });
});
