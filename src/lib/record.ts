import { isValidYmd } from "@/lib/dates";
import { isStoredCents } from "@/lib/money";
import { CATEGORIES, type Category, type Transaction } from "@/lib/types";

export type EditableRecord = {
  amountCents: number;
  date: string;
  merchant: string;
  category: Category;
  note: string;
};

export function parseEditable(input: unknown): { ok: true; value: EditableRecord } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") return { ok: false, reason: "内容不完整" };
  const body = input as Record<string, unknown>;
  if ("amount" in body || "yuan" in body) return { ok: false, reason: "请用整数分 amountCents，不要混用元的小数" };
  if (!isStoredCents(body.amountCents)) return { ok: false, reason: "金额需要是非零的整数分" };
  if (typeof body.date !== "string" || !isValidYmd(body.date)) return { ok: false, reason: "日期无效" };
  if (typeof body.merchant !== "string") return { ok: false, reason: "请填写商户或说明" };
  const merchant = body.merchant.trim().replace(/\s+/g, " ");
  if (!merchant || [...merchant].length > 40) return { ok: false, reason: "商户需要 1 到 40 个字" };
  if (typeof body.category !== "string" || !CATEGORIES.includes(body.category as Category)) {
    return { ok: false, reason: "分类不在可选范围里" };
  }
  const noteSource = body.note == null ? "" : body.note;
  if (typeof noteSource !== "string") return { ok: false, reason: "备注格式不对" };
  const note = noteSource.trim();
  if ([...note].length > 80) return { ok: false, reason: "备注最多 80 个字" };
  return {
    ok: true,
    value: { amountCents: body.amountCents, date: body.date, merchant, category: body.category as Category, note },
  };
}

export function fingerprint(record: Pick<Transaction, "date" | "amountCents" | "category" | "merchant">): string {
  return [record.date, String(record.amountCents), record.category, record.merchant.trim().toLowerCase()].join("|");
}
