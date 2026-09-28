// Paginate tests.
import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

const list = Array.from({ length: 23 }, (_, i) => i);

describe("paginate", () => {
  it("returns the first page", () => {
    expect(paginate(list, 1, 10)).toEqual({ items: list.slice(0, 10), page: 1, totalPages: 3, offset: 0 });
  });

  it("returns a partial last page", () => {
    expect(paginate(list, 3, 10)).toEqual({ items: [20, 21, 22], page: 3, totalPages: 3, offset: 20 });
  });

  it("clamps pages past the end", () => {
    expect(paginate(list, 99, 10).page).toBe(3);
  });

  it("clamps pages below 1 and non-numeric pages", () => {
    expect(paginate(list, 0, 10).page).toBe(1);
    expect(paginate(list, -4, 10).page).toBe(1);
    expect(paginate(list, NaN, 10).page).toBe(1);
  });

  it("treats an empty list as a single empty page", () => {
    expect(paginate([], 2, 10)).toEqual({ items: [], page: 1, totalPages: 1, offset: 0 });
  });

  it("has exactly one page when the list fits", () => {
    expect(paginate(list, 1, 23).totalPages).toBe(1);
    expect(paginate(list, 1, 22).totalPages).toBe(2);
  });

  it("rejects invalid page sizes", () => {
    expect(() => paginate(list, 1, 0)).toThrow(RangeError);
    expect(() => paginate(list, 1, 2.5)).toThrow(RangeError);
  });
});
