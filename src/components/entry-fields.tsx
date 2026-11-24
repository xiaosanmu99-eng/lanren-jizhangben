"use client";

import { useState } from "react";
import { STARTER_TAGS } from "@/lib/types";
import { isValidYmd } from "@/lib/dates";
import { yuanToCents, yuanInputFromCents } from "@/lib/money";
import { charLength, cleanText, entryDescription, splitDescription, TAG_MAX_LENGTH } from "@/lib/record";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Draft } from "@/lib/parse";

export type FieldValues = {
  amountInput: string;
  refund: boolean;
  category: string;
  description: string;
  date: string;
};

export function fieldsFromDraft(draft: Draft, today: string): FieldValues {
  return {
    amountInput: draft.amountInput,
    refund: draft.refund,
    category: draft.category ?? "",
    description: draft.note || draft.merchant,
    date: draft.date ?? today,
  };
}

export function emptyFields(today: string): FieldValues {
  return { amountInput: "", refund: false, category: "", description: "", date: today };
}

export function fieldsFromTransaction(item: {
  amountCents: number;
  category: string;
  merchant: string;
  note: string;
  date: string;
}): FieldValues {
  return {
    amountInput: yuanInputFromCents(item.amountCents),
    refund: item.amountCents < 0,
    category: item.category,
    description: entryDescription(item),
    date: item.date,
  };
}

const AMOUNT_MESSAGE = {
  empty: "请填写金额",
  format: "金额格式不对",
  precision: "金额只保留到分",
  zero: "金额不能是 0",
  range: "金额太大了",
} as const;

export function payloadFromFields(
  fields: FieldValues,
  previous?: { merchant: string; note: string },
):
  | { ok: true; body: { amountCents: number; date: string; merchant: string; category: string; note: string } }
  | { ok: false; message: string } {
  const amount = yuanToCents(fields.amountInput);
  if (!amount.ok) return { ok: false, message: AMOUNT_MESSAGE[amount.reason] };
  if (!isValidYmd(fields.date)) return { ok: false, message: "日期无效" };
  const description = cleanText(fields.description);
  const category = cleanText(fields.category);
  if (charLength(category) > TAG_MAX_LENGTH) return { ok: false, message: "标签最多 20 个字" };
  const amountCents = fields.refund ? -amount.cents : amount.cents;
  if (previous && description === cleanText(entryDescription(previous))) {
    if (!cleanText(previous.merchant) && !cleanText(previous.note) && !category) {
      return { ok: false, message: "写一句说明，或选一个标签" };
    }
    return {
      ok: true,
      body: { amountCents, date: fields.date, merchant: previous.merchant, category, note: previous.note },
    };
  }
  const text = splitDescription(description, category);
  if (!text.ok) return { ok: false, message: text.reason };
  return {
    ok: true,
    body: { amountCents, date: fields.date, merchant: text.merchant, category: text.category, note: text.note },
  };
}

export function EntryFields({
  values,
  onChange,
  idPrefix,
  knownTags,
}: {
  values: FieldValues;
  onChange: (next: FieldValues) => void;
  idPrefix: string;
  knownTags: string[];
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
        <Toggle pressed={!values.refund} onClick={() => onChange({ ...values, refund: false })}>
          支出
        </Toggle>
        <Toggle pressed={values.refund} onClick={() => onChange({ ...values, refund: true })}>
          退款
        </Toggle>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-description`}>说明</Label>
        <textarea
          id={`${idPrefix}-description`}
          value={values.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
          rows={2}
          placeholder="买书、理发，写一句就好"
          className="min-h-12 w-full resize-none rounded-2xl border border-input bg-card px-3 py-3 text-base leading-6 outline-none placeholder:text-muted-foreground"
        />
      </div>
      <TagPicker
        idPrefix={idPrefix}
        value={values.category}
        knownTags={knownTags}
        onChange={(category) => onChange({ ...values, category })}
      />
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
    </div>
  );
}

function TagPicker({
  idPrefix,
  value,
  knownTags,
  onChange,
}: {
  idPrefix: string;
  value: string;
  knownTags: string[];
  onChange: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const selected = cleanText(value);
  const seen = new Set<string>();
  const options: string[] = [];
  for (const tag of [...STARTER_TAGS, ...knownTags, ...added, selected]) {
    const clean = cleanText(tag);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    options.push(clean);
  }

  function add() {
    const clean = cleanText(draft);
    if (!clean) return;
    if ([...clean].length > TAG_MAX_LENGTH) {
      setMessage("标签最多 20 个字");
      return;
    }
    setAdded((current) => (current.includes(clean) ? current : [...current, clean]));
    onChange(clean);
    setDraft("");
    setMessage(null);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-tag`}>标签，可不选</Label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="标签，可不选">
        {options.map((tag) => {
          const pressed = selected === tag;
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(pressed ? "" : tag)}
              className={`h-10 rounded-full px-3 text-sm ${pressed ? "bg-[#C24B24] text-[#FFF8F3]" : "bg-[#FFFBF5] text-[#241910] ring-1 ring-[#E4D5C3]"}`}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-tag`}
          value={draft}
          maxLength={TAG_MAX_LENGTH}
          onChange={(event) => {
            setDraft(event.target.value);
            if (message) setMessage(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="自己的标签"
          className="h-12 min-w-0 flex-1 rounded-2xl bg-card px-3 text-base"
        />
        <button
          type="button"
          onClick={add}
          className="h-12 shrink-0 rounded-2xl bg-[#241910] px-4 text-base text-[#FFF8F3]"
        >
          添加
        </button>
      </div>
      {message ? <p className="text-sm text-[#9C2C2C]">{message}</p> : null}
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
