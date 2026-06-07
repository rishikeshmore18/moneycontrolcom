// CashFlow Control — domain types

export type Theme = "light" | "dark" | "system";

export interface Profile {
  name: string;
  currency: string;
  theme: Theme;
  safeToSpendFloor: number;
}

export type AccountType = "checking" | "savings" | "cash" | "other";

export interface Account {
  id: string;
  bankName: string;
  name: string;
  type: AccountType;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export type CardType = "regular" | "zero_apr" | "zero_apr_car" | "other";

export interface Card {
  id: string;
  name: string;
  type: CardType;
  limit: number;
  currentBalance: number;
  statementBalance: number;
  minimumDue: number;
  billingDate: number; // day of month
  dueDate: number; // day of month
  apr: number;
  zeroAprEndDate?: string;
  targetUtilizationPercent: number;
  preferredCategories: string[];
}

export type DebtStatus = "active" | "not_started" | "paused" | "paid_off";

export interface Debt {
  id: string;
  name: string;
  balance: number;
  minimumPayment: number;
  dueDate: number; // day of month
  status: DebtStatus;
  notes?: string;
}

export type JobType = "full_time" | "part_time" | "custom";
export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface Job {
  id: string;
  name: string;
  type: JobType;
  netHourlyRate: number;
  netPaycheckAmount: number;
  payFrequency: PayFrequency;
  paydayWeekday: number; // 0=Sun..6=Sat
  biweeklyAnchorDate?: string; // ISO date
  semimonthlyDays?: [number, number]; // e.g. [1, 15]
  defaultDepositAccountId: string;
}

export type TimesheetEntryType = "work_shift" | "time_off" | "salary_paycheck";
export type PayStatus = "unpaid" | "paid";

export interface TimesheetEntry {
  id: string;
  jobId: string;
  jobName: string;
  entryType: TimesheetEntryType;
  date: string; // ISO date (YYYY-MM-DD)
  startTime?: string; // HH:MM
  endTime?: string;
  hours: number;
  rate: number;
  expectedAmount: number;
  actualAmount?: number;
  paid: boolean;
  paidAccountId?: string;
  payStatus: PayStatus;
  createdAt: string;
  updatedAt: string;
  userEdited: boolean;
  auto?: boolean; // synthesized from job schedule
}

export type TransactionType =
  | "expense"
  | "income"
  | "card_payment"
  | "debt_payment"
  | "transfer"
  | "adjustment";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  cardId?: string;
  debtId?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  accountId: string;
  active: boolean;
}

export interface AppState {
  schemaVersion: number;
  onboarded: boolean;
  profile: Profile;
  accounts: Account[];
  cards: Card[];
  debts: Debt[];
  jobs: Job[];
  timesheet: TimesheetEntry[];
  transactions: Transaction[];
  recurringBills: RecurringBill[];
}

export const SCHEMA_VERSION = 1;

export const defaultProfile: Profile = {
  name: "",
  currency: "USD",
  theme: "system",
  safeToSpendFloor: 100,
};

export const emptyState: AppState = {
  schemaVersion: SCHEMA_VERSION,
  onboarded: false,
  profile: defaultProfile,
  accounts: [],
  cards: [],
  debts: [],
  jobs: [],
  timesheet: [],
  transactions: [],
  recurringBills: [],
};
