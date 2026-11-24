import assert from "node:assert/strict";
import { test } from "node:test";
import { planImport } from "./backup.ts";
import type { Transaction } from "./types.ts";

function record(partial: Partial<Transaction> & Pick<Transaction, "id" | "amountCents" | "merchant">): Transaction {
  return {
    date: "2026-11-23",
    category: "食堂",
    note: "",
    externalId: null,
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    ...partial,
  };
}

test("import warns on repeated ids and identical spending without writing", () => {
  const existing = record({ id: "existing1", amountCents: 1800, merchant: "食堂" });
  const backup = {
    app: "懒人记账本",
    schema: 1,
    transactions: [
      existing,
      existing,
      record({ id: "same-print", amountCents: 1800, merchant: "食堂" }),
      record({ id: "fresh-item", amountCents: 400, merchant: "地铁", category: "交通" }),
      { amountCents: 12.5, date: "2026-11-23", merchant: "坏账", category: "食堂" },
    ],
  };
  const plan = planImport([existing], backup);
  assert.deepEqual(plan.duplicateIds, ["existing1", "existing1"]);
  assert.equal(plan.suspects.length, 1);
  assert.equal(plan.suspects[0].id, "same-print");
  assert.equal(plan.freshCount, 1);
  assert.equal(plan.fresh[0].id, "fresh-item");
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.inserted, 0);
});

test("import keeps legacy categories and accepts custom or empty tags", () => {
  const backup = {
    app: "懒人记账本",
    schema: 1,
    transactions: [
      record({ id: "legacyitem", amountCents: 1800, merchant: "食堂", category: "食堂", note: "味道一般" }),
      record({ id: "customitem", amountCents: 3000, merchant: "理发", category: "理发" }),
      record({ id: "plainitem1", amountCents: 3500, merchant: "买书", category: "" }),
      record({ id: "notemerch1", amountCents: 1200, merchant: "", category: "书", note: "周末买书" }),
      record({ id: "tagonlyitem", amountCents: 800, merchant: "", category: "交通" }),
      record({ id: "toolongtag1", amountCents: 800, merchant: "东西", category: "标".repeat(21) }),
      { id: "emptyrow01", amountCents: 800, date: "2026-11-23", merchant: "", category: "", note: "" },
    ],
  };
  const plan = planImport([], backup);
  assert.deepEqual(
    plan.fresh.map((item) => [item.id, item.merchant, item.category, item.note]),
    [
      ["legacyitem", "食堂", "食堂", "味道一般"],
      ["customitem", "理发", "理发", ""],
      ["plainitem1", "买书", "", ""],
      ["notemerch1", "周末买书", "书", "周末买书"],
      ["tagonlyitem", "交通", "交通", ""],
    ],
  );
  assert.deepEqual(
    plan.invalid.map((item) => item.index),
    [5, 6],
  );
});

test("a foreign backup shape is rejected", () => {
  const plan = planImport([], { app: "other", schema: 2, transactions: [] });
  assert.equal(plan.freshCount, 0);
  assert.equal(plan.invalid[0].reason, "备份不是这一版的 JSON");
});
