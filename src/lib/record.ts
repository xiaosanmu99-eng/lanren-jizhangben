import { isValidYmd } from "@/lib/dates";
import { isStoredCents } from "@/lib/money";
import type { Transaction } from "@/lib/types";

export const TAG_MAX_LENGTH = 20;
export const MERCHANT_MAX_LENGTH = 40;
export const DESCRIPTION_MAX_LENGTH = 80;

export type EditableRecord = {
  amountCents: number;
  date: string;
  merchant: string;
  category: string;
  note: string;
};

export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function charLength(value: string): number {
  return [...value].length;
}

export function clipChars(value: string, max: number): string {
  return [...value].slice(0, max).join("");
}

export function entryDescription(record: { merchant: string; note: string }): string {
  const merchant = cleanText(record.merchant);
  const note = cleanText(record.note);
  if (!note || note === merchant) return merchant;
  if (note.startsWith(merchant)) return note;
  return cleanText(`${merchant} ${note}`);
}

export function splitDescription(
  description: string,
  category: string,
): { ok: true; merchant: string; category: string; note: string } | { ok: false; reason: string } {
  const text = cleanText(description);
  const tag = cleanText(category);
  if (charLength(tag) > TAG_MAX_LENGTH) return { ok: false, reason: "标签最多 20 个字" };
  if (charLength(text) > DESCRIPTION_MAX_LENGTH) return { ok: false, reason: "说明最多 80 个字" };
  if (!text && !tag) return { ok: false, reason: "写一句说明，或选一个标签" };
  if (!text) return { ok: true, merchant: clipChars(tag, MERCHANT_MAX_LENGTH), category: tag, note: "" };
  if (charLength(text) <= MERCHANT_MAX_LENGTH) return { ok: true, merchant: text, category: tag, note: "" };
  return { ok: true, merchant: clipChars(text, MERCHANT_MAX_LENGTH), category: tag, note: text };
}

export function parseEditable(input: unknown): { ok: true; value: EditableRecord } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") return { ok: false, reason: "内容不完整" };
  const body = input as Record<string, unknown>;
  if ("amount" in body || "yuan" in body) return { ok: false, reason: "请用整数分 amountCents，不要混用元的小数" };
  if (!isStoredCents(body.amountCents)) return { ok: false, reason: "金额需要是非零的整数分" };
  if (typeof body.date !== "string" || !isValidYmd(body.date)) return { ok: false, reason: "日期无效" };

  const tag = readTag(body.category);
  if (!tag.ok) return tag;
  if (body.note != null && body.note !== "" && typeof body.note !== "string") {
    return { ok: false, reason: "说明格式不对" };
  }
  const note = typeof body.note === "string" ? cleanText(body.note) : "";
  if (charLength(note) > DESCRIPTION_MAX_LENGTH) return { ok: false, reason: "说明最多 80 个字" };
  if (body.merchant != null && body.merchant !== "" && typeof body.merchant !== "string") {
    return { ok: false, reason: "说明格式不对" };
  }
  let merchant = typeof body.merchant === "string" ? cleanText(body.merchant) : "";
  if (merchant && charLength(merchant) > MERCHANT_MAX_LENGTH) {
    return { ok: false, reason: "说明需要 1 到 40 个字" };
  }
  if (!merchant) {
    if (note) merchant = clipChars(note, MERCHANT_MAX_LENGTH);
    else if (tag.tag) merchant = clipChars(tag.tag, MERCHANT_MAX_LENGTH);
    else return { ok: false, reason: "写一句说明，或选一个标签" };
  }

  return {
    ok: true,
    value: { amountCents: body.amountCents, date: body.date, merchant, category: tag.tag, note },
  };
}

function readTag(value: unknown): { ok: true; tag: string } | { ok: false; reason: string } {
  if (value == null || value === "") return { ok: true, tag: "" };
  if (typeof value !== "string") return { ok: false, reason: "标签格式不对" };
  const tag = cleanText(value);
  if (charLength(tag) > TAG_MAX_LENGTH) return { ok: false, reason: "标签最多 20 个字" };
  return { ok: true, tag };
}

export function fingerprint(record: Pick<Transaction, "date" | "amountCents" | "category" | "merchant">): string {
  return [record.date, String(record.amountCents), record.category, record.merchant.trim().toLowerCase()].join("|");
}
