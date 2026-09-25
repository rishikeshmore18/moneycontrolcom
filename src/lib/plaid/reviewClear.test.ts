import { describe, expect, it } from "vitest";
import { validateClearRange } from "./reviewClear";

describe("review clear dates", () => {
  it("accepts all, a strict before date, and an inclusive interval", () => {
    expect(validateClearRange({ mode: "all" })).toEqual({ mode: "all" });
    expect(validateClearRange({ mode: "before", before: "2026-09-25" })).toEqual({
      mode: "before", before: "2026-09-25",
    });
    expect(validateClearRange({ mode: "between", start: "2026-09-25", end: "2026-09-25" })).toEqual({
      mode: "between", start: "2026-09-25", end: "2026-09-25",
    });
  });

  it("rejects reversed dates and impossible calendar dates", () => {
    expect(() => validateClearRange({ mode: "between", start: "2026-09-26", end: "2026-09-25" })).toThrow();
    expect(() => validateClearRange({ mode: "before", before: "2026-02-30" })).toThrow();
    expect(() => validateClearRange({ mode: "between", start: "", end: "2026-09-25" })).toThrow();
  });
});
