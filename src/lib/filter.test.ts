import assert from "node:assert/strict";
import { test } from "node:test";
import { hasUntagged, tagsInLedger } from "./categories.ts";
import { filterTransactions } from "./filter.ts";
import type { Transaction } from "./types.ts";

function row(partial: Pick<Transaction, "id" | "merchant" | "category" | "note">): Transaction {
  return {
    amountCents: 100,
    date: "2026-11-23",
    externalId: null,
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    ...partial,
  };
}

const rows = [
  row({ id: "canteen1", merchant: "食堂", category: "食堂", note: "" }),
  row({ id: "haircut1", merchant: "理发", category: "理发", note: "" }),
  row({ id: "book0001", merchant: "买书", category: "", note: "周末的书" }),
];

test("filters follow tags that exist, including untagged rows", () => {
  assert.deepEqual(tagsInLedger(rows), ["食堂", "理发"]);
  assert.equal(hasUntagged(rows), true);
  assert.deepEqual(
    filterTransactions(rows, { tag: "理发" }).map((item) => item.id),
    ["haircut1"],
  );
  assert.deepEqual(
    filterTransactions(rows, { untagged: true }).map((item) => item.id),
    ["book0001"],
  );
  assert.deepEqual(
    filterTransactions(rows, { q: "周末" }).map((item) => item.id),
    ["book0001"],
  );
  assert.equal(filterTransactions(rows, {}).length, 3);
});
