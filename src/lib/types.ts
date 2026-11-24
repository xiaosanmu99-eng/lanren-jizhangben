export const CATEGORIES = ["食堂", "其他餐饮", "交通", "购物", "其他"] as const;

export type Category = (typeof CATEGORIES)[number];

export type Transaction = {
  id: string;
  amountCents: number;
  date: string;
  merchant: string;
  category: Category;
  note: string;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeekDay = {
  date: string;
  weekday: string;
  expenseCents: number;
  refundCents: number;
  netCents: number;
};

export type WeekCategory = {
  category: Category;
  expenseCents: number;
  refundCents: number;
  netCents: number;
  sharePercent: number;
};

export type WeekSummary = {
  start: string;
  end: string;
  timeZone: "Asia/Shanghai";
  expenseCents: number;
  refundCents: number;
  netCents: number;
  days: WeekDay[];
  categories: WeekCategory[];
};

export type SessionState = {
  authenticated: boolean;
  ownerExists: boolean;
  setupAvailable: boolean;
  today: string;
  timeZone: "Asia/Shanghai";
  scope: "preview" | "hosted";
  notice: string;
  ingestionConfigured: boolean;
  scheduleConfigured: false;
};

export type ImportSuspect = {
  id: string;
  date: string;
  merchant: string;
  amountCents: number;
  category: Category;
};

export type ImportReport = {
  committed: boolean;
  inserted: number;
  freshCount: number;
  duplicateIds: string[];
  suspects: ImportSuspect[];
  invalid: { index: number; reason: string }[];
};
