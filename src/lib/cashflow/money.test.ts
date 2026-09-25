import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("financial display", () => {
  it("shows real zero and cent amounts but never disguises an invalid balance as zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(8_269.09)).toBe("$8,269.09");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
