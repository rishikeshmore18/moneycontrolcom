export type ClearInboxRange =
  | { mode: "all" }
  | { mode: "before"; before: string }
  | { mode: "between"; start: string; end: string };

function validReviewDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateClearRange(input: ClearInboxRange): ClearInboxRange {
  if (input?.mode === "all") return { mode: "all" };
  if (input?.mode === "before" && validReviewDate(input.before)) {
    return { mode: "before", before: input.before };
  }
  if (input?.mode === "between" && validReviewDate(input.start) &&
    validReviewDate(input.end) && input.start <= input.end) {
    return { mode: "between", start: input.start, end: input.end };
  }
  throw new Error("Choose valid dates in order before clearing transactions.");
}
