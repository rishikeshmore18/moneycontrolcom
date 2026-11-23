import { describe, expect, it } from "vitest";
import { effectiveCardBilling, issuerPaymentStatus } from "./cardLiability";
import type { Card } from "./types";
const card = (patch: Partial<Card> = {}): Card => ({
  id: "c", name: "Card", type: "regular", limit: 5000, currentBalance: 1100,
  statementBalance: 700, minimumDue: 25, billingDate: 12, dueDate: 7, apr: 22,
  targetUtilizationPercent: 30, preferredCategories: [], ...patch
});
const snapshot = { accountId:"p", statementBalance:900, statementIssueDate:"2026-11-18",
  minimumDue:35, issuerDueDate:"2026-12-13", lastPaymentAmount:null,
  lastPaymentDate:null, issuerOverdue:false, syncedAt:"2026-11-23T09:00:00Z" };
describe("issuer billing boundaries",()=>{
  it("keeps the actual statement apart from current debt and manual fallback",()=>{
    const value=effectiveCardBilling(card({plaidLiability:snapshot}),new Date("2026-11-23T12:00:00Z"));
    expect(value.statementBalance).toBe(900);
    expect(value.minimumDue).toBe(35);
    expect(value.issuerDueDate).toBe("2026-12-13");
    expect(card().statementBalance).toBe(700);
  });
  it("preserves known zero and manual fallback when issuer fields are null",()=>{
    const value=effectiveCardBilling(card({plaidLiability:{...snapshot,statementBalance:0,minimumDue:null}}),new Date("2026-11-23T12:00:00Z"));
    expect(value.statementBalance).toBe(0);
    expect(value.minimumDue).toBe(25);
  });
  it("never treats stale Plaid data as confirmed",()=>{
    const value=effectiveCardBilling(card({plaidLiability:snapshot}),new Date("2026-12-01T12:00:00Z"));
    expect(value.statementBalance).toBe(700);
    expect(value.fresh).toBe(false);
  });
  it("does not invent issuer delinquency from a passed due date",()=>{
    expect(issuerPaymentStatus(card({plaidLiability:{...snapshot,issuerDueDate:"2026-11-20"}}),"2026-11-23")).toBe("unknown");
    expect(issuerPaymentStatus(card({plaidLiability:{...snapshot,issuerOverdue:true}}),"2026-11-23")).toBe("issuer_overdue");
  });
});
