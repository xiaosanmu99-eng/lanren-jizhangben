import { CATEGORY_RULES } from "@/lib/categories";
import { addDays, isValidYmd } from "@/lib/dates";
import { yuanToCents } from "@/lib/money";
import type { Category } from "@/lib/types";

export const REASON_TEXT = {
  missing_amount: "没有识别到金额",
  multiple_amounts: "有不止一个数字，要确认哪一个是金额",
  excess_precision: "小数超过两位，请改成以分为止",
  zero_amount: "金额是 0",
  amount_too_large: "金额太大",
  missing_category: "没有识别到分类",
  multiple_categories: "一句话里有不止一种分类",
  missing_merchant: "没有商户或说明",
  invalid_date: "日期无效",
  multiple_dates: "有不止一个日期",
} as const;

export type ReasonCode = keyof typeof REASON_TEXT;

export type Draft = {
  amountCents: number | null;
  amountInput: string;
  refund: boolean;
  category: Category | null;
  merchant: string;
  date: string | null;
  note: string;
};

export type ParseOutcome = {
  status: "empty" | "ready" | "needs_confirmation";
  reasons: ReasonCode[];
  draft: Draft;
};

type Span = { start: number; end: number };

const MARKED =
  /(?:¥|￥)\s*(\d{1,6}(?:\.\d+)?)(?![\d.])|(?<![\d.])(\d{1,6}(?:\.\d+)?)(?![\d.])\s*(?:元|块钱|块)/g;
const BARE = /(?<![\d.])(\d{1,6}(?:\.\d+)?)(?![\d.])/g;
const REFUND_WORD = /退款|退回|退费|退了|(?<![\u4e00-\u9fff])退(?![\u4e00-\u9fff])/g;

export function parseEntry(input: string, today: string): ParseOutcome {
  const source = input.trim();
  const emptyDraft: Draft = {
    amountCents: null,
    amountInput: "",
    refund: false,
    category: null,
    merchant: "",
    date: today,
    note: "",
  };
  if (!source) return { status: "empty", reasons: [], draft: emptyDraft };

  const dateSpans = findDates(source);
  const dateResult = resolveDates(source, dateSpans, today);
  const amountSpans = findAmounts(source).filter(
    (span) => !dateSpans.some((dateSpan) => overlaps(span, dateSpan)),
  );
  const chosen = chooseAmounts(amountSpans);
  const categories = findCategories(source);
  REFUND_WORD.lastIndex = 0;
  const refund = amountSpans.some((span) => span.refund) || REFUND_WORD.test(source);
  REFUND_WORD.lastIndex = 0;

  const merchant = cleanMerchant(
    stripSpans(source, [...dateSpans, ...amountSpans, ...findRefundSpans(source)]),
  );

  const reasons: ReasonCode[] = [];
  if (dateResult.kind === "multiple") reasons.push("multiple_dates");
  if (dateResult.kind === "invalid") reasons.push("invalid_date");
  if (chosen.kind === "none") reasons.push("missing_amount");
  if (chosen.kind === "multiple") reasons.push("multiple_amounts");
  if (chosen.kind === "precision") reasons.push("excess_precision");
  if (chosen.kind === "zero") reasons.push("zero_amount");
  if (chosen.kind === "range") reasons.push("amount_too_large");
  if (categories.length === 0) reasons.push("missing_category");
  if (categories.length > 1) reasons.push("multiple_categories");

  const category = categories.length === 1 ? categories[0] : null;
  const resolvedMerchant = merchant || (category && reasons.every((reason) => reason !== "multiple_categories") ? category : "");
  if (!resolvedMerchant) reasons.push("missing_merchant");

  const amount = chosen.kind === "one" ? yuanToCents(chosen.raw) : null;
  const amountCents =
    amount && amount.ok ? (refund ? -amount.cents : amount.cents) : null;
  const draft: Draft = {
    amountCents,
    amountInput: chosen.kind === "none" || chosen.kind === "multiple" ? "" : chosen.raw,
    refund,
    category,
    merchant: resolvedMerchant,
    date: dateResult.kind === "one" ? dateResult.date : null,
    note: "",
  };

  if (draft.date === null && !reasons.includes("multiple_dates") && !reasons.includes("invalid_date")) {
    draft.date = today;
  }

  return {
    status: reasons.length === 0 ? "ready" : "needs_confirmation",
    reasons,
    draft,
  };
}

function findDates(source: string): Span[] {
  const spans: Span[] = [];
  for (const match of source.matchAll(/今天|昨天|前天|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日/g)) {
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return spans;
}

function resolveDates(
  source: string,
  spans: Span[],
  today: string,
): { kind: "none" } | { kind: "one"; date: string } | { kind: "multiple" } | { kind: "invalid" } {
  if (spans.length === 0) return { kind: "none" };
  if (spans.length > 1) return { kind: "multiple" };
  const token = source.slice(spans[0].start, spans[0].end);
  let date = today;
  if (token === "昨天") date = addDays(today, -1);
  else if (token === "前天") date = addDays(today, -2);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) date = token;
  else {
    const match = /^(\d{1,2})月(\d{1,2})日$/.exec(token);
    if (!match) return { kind: "invalid" };
    date = `${today.slice(0, 4)}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }
  return isValidYmd(date) ? { kind: "one", date } : { kind: "invalid" };
}

type AmountSpan = Span & { raw: string; refund: boolean; marked: boolean };

function findAmounts(source: string): AmountSpan[] {
  const marked = collectAmounts(source, MARKED, true);
  return marked.length > 0 ? marked : collectAmounts(source, BARE, false);
}

function collectAmounts(source: string, pattern: RegExp, marked: boolean): AmountSpan[] {
  pattern.lastIndex = 0;
  const spans: AmountSpan[] = [];
  for (const match of source.matchAll(pattern)) {
    const raw = match[1] || match[2] || "";
    const matchStart = match.index ?? 0;
    const minus = leadingMinus(source, matchStart);
    spans.push({
      start: minus.spanStart,
      end: matchStart + match[0].length,
      raw,
      refund: minus.refund,
      marked,
    });
  }
  pattern.lastIndex = 0;
  return spans;
}

function chooseAmounts(
  spans: AmountSpan[],
): { kind: "none" } | { kind: "multiple" } | { kind: "one" | "precision" | "zero" | "range"; raw: string } {
  if (spans.length === 0) return { kind: "none" };
  if (spans.length > 1) return { kind: "multiple" };
  const parsed = yuanToCents(spans[0].raw);
  if (parsed.ok) return { kind: "one", raw: spans[0].raw };
  if (parsed.reason === "precision") return { kind: "precision", raw: spans[0].raw };
  if (parsed.reason === "zero") return { kind: "zero", raw: spans[0].raw };
  if (parsed.reason === "range") return { kind: "range", raw: spans[0].raw };
  return { kind: "none" };
}

function leadingMinus(source: string, start: number): { refund: boolean; spanStart: number } {
  let index = start - 1;
  while (index >= 0 && source[index] === " ") index -= 1;
  if (index >= 0 && (source[index] === "-" || source[index] === "－")) {
    return { refund: true, spanStart: index };
  }
  return { refund: false, spanStart: start };
}

function findCategories(source: string): Category[] {
  const hits: { category: Category; start: number; end: number }[] = [];
  for (const rule of CATEGORY_RULES) {
    for (const word of rule.words) {
      let from = 0;
      while (from < source.length) {
        const index = source.indexOf(word, from);
        if (index < 0) break;
        hits.push({ category: rule.category, start: index, end: index + word.length });
        from = index + word.length;
      }
    }
  }
  const kept = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other.end - other.start > hit.end - hit.start &&
          other.start <= hit.start &&
          other.end >= hit.end,
      ),
  );
  return [...new Set(kept.map((hit) => hit.category))];
}

function findRefundSpans(source: string): Span[] {
  return [...source.matchAll(REFUND_WORD)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function stripSpans(source: string, spans: Span[]): string {
  const ordered = [...spans].sort((left, right) => right.start - left.start);
  let text = source;
  for (const span of ordered) {
    text = `${text.slice(0, span.start)} ${text.slice(span.end)}`;
  }
  return text;
}

function cleanMerchant(value: string): string {
  return value.replace(/[¥￥,，。．.、]/g, " ").replace(/\s+/g, " ").trim();
}

function overlaps(left: Span, right: Span): boolean {
  return left.start < right.end && right.start < left.end;
}
