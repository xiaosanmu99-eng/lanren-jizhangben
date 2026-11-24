"use client";

import { CATEGORIES, type Category } from "@/lib/types";
import { isValidYmd } from "@/lib/dates";
import { yuanToCents } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Draft } from "@/lib/parse";

export type FieldValues = {
  amountInput: string;
  refund: boolean;
  category: Category | "";
  merchant: string;
  date: string;
  note: string;
};

export function fieldsFromDraft(draft: Draft, today: string): FieldValues {
  return {
    amountInput: draft.amountInput,
    refund: draft.refund,
    category: draft.category ?? "",
    merchant: draft.merchant,
    date: draft.date ?? today,
    note: draft.note,
  };
}

export function emptyFields(today: string): FieldValues {
  return { amountInput: "", refund: false, category: "", merchant: "", date: today, note: "" };
}

const AMOUNT_MESSAGE = {
  empty: "请填写金额",
  format: "金额格式不对",
  precision: "金额只保留到分",
  zero: "金额不能是 0",
  range: "金额太大了",
} as const;

export function payloadFromFields(fields: FieldValues):
  | { ok: true; body: { amountCents: number; date: string; merchant: string; category: Category; note: string } }
  | { ok: false; message: string } {
  const amount = yuanToCents(fields.amountInput);
  if (!amount.ok) return { ok: false, message: AMOUNT_MESSAGE[amount.reason] };
  if (!fields.category) return { ok: false, message: "请选择分类" };
  const merchant = fields.merchant.trim().replace(/\s+/g, " ");
  if (!merchant) return { ok: false, message: "请填写商户或说明" };
  if ([...merchant].length > 40) return { ok: false, message: "商户最多 40 个字" };
  if (!isValidYmd(fields.date)) return { ok: false, message: "日期无效" };
  const note = fields.note.trim();
  if ([...note].length > 80) return { ok: false, message: "备注最多 80 个字" };
  return {
    ok: true,
    body: {
      amountCents: fields.refund ? -amount.cents : amount.cents,
      date: fields.date,
      merchant,
      category: fields.category,
      note,
    },
  };
}

export function EntryFields({
  values,
  onChange,
  idPrefix,
}: {
  values: FieldValues;
  onChange: (next: FieldValues) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-amount`}>金额（元）</Label>
        <Input
          id={`${idPrefix}-amount`}
          inputMode="decimal"
          autoComplete="off"
          value={values.amountInput}
          onChange={(event) => onChange({ ...values, amountInput: event.target.value })}
          className="h-12 rounded-2xl bg-card px-3 text-base"
          placeholder="18.50"
        />
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="这笔是支出还是退款">
        <Toggle
          pressed={!values.refund}
          onClick={() => onChange({ ...values, refund: false })}
        >
          支出
        </Toggle>
        <Toggle pressed={values.refund} onClick={() => onChange({ ...values, refund: true })}>
          退款
        </Toggle>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-category`}>分类</Label>
        <select
          id={`${idPrefix}-category`}
          value={values.category}
          onChange={(event) => onChange({ ...values, category: event.target.value as Category | "" })}
          className="h-12 rounded-2xl border border-input bg-card px-3 text-base"
        >
          <option value="">请选择</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-merchant`}>商户或说明</Label>
        <Input
          id={`${idPrefix}-merchant`}
          value={values.merchant}
          onChange={(event) => onChange({ ...values, merchant: event.target.value })}
          className="h-12 rounded-2xl bg-card px-3 text-base"
          placeholder="食堂"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-date`}>日期（上海）</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={values.date}
          onChange={(event) => onChange({ ...values, date: event.target.value })}
          className="h-12 rounded-2xl bg-card px-3 text-base"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-note`}>备注，可空</Label>
        <Input
          id={`${idPrefix}-note`}
          value={values.note}
          onChange={(event) => onChange({ ...values, note: event.target.value })}
          className="h-12 rounded-2xl bg-card px-3 text-base"
        />
      </div>
    </div>
  );
}

function Toggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-11 rounded-2xl border text-base ${pressed ? "border-[#C24B24] bg-[#C24B24] text-[#FFF8F3]" : "border-[#E4D5C3] bg-card text-[#241910]"}`}
    >
      {children}
    </button>
  );
}
