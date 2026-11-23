import { describe, expect, it } from "vitest";
import { normalizeCreditLiability } from "./liabilities";
describe("Plaid issuer field normalization", () => {
  it("preserves genuine zero values and nullable unknown values", () => {
    expect(normalizeCreditLiability({
      account_id:"a", last_statement_balance:0, minimum_payment_amount:null,
      next_payment_due_date:null, is_overdue:false,
    },"2026-11-23T12:00:00Z")).toMatchObject({
      statement_balance:0, minimum_due:null, issuer_due_date:null, issuer_overdue:false,
    });
  });
  it("rejects invalid dates, malformed numbers, and fabricated late status", () => {
    expect(normalizeCreditLiability({
      account_id:"a", last_statement_balance:Number.NaN, minimum_payment_amount:Number.POSITIVE_INFINITY,
      next_payment_due_date:"2026-02-30", last_statement_issue_date:"tomorrow",
    },"2026-11-23T12:00:00Z")).toMatchObject({
      statement_balance:null, minimum_due:null, issuer_due_date:null, statement_issue_date:null, issuer_overdue:null,
    });
  });
  it("allows valid ISO issuer dates without deriving the user payment date", () => {
    expect(normalizeCreditLiability({
      account_id:"a", last_statement_balance:900,
      last_statement_issue_date:"2026-11-18", next_payment_due_date:"2026-12-13",
    },"2026-11-23T12:00:00Z")).toMatchObject({
      statement_issue_date:"2026-11-18", issuer_due_date:"2026-12-13",
    });
  });
});
