import assert from "node:assert/strict";
import { test } from "node:test";
import { entryDescription, parseEditable, splitDescription } from "./record.ts";

test("a description or a tag is enough, and legacy rows still parse", () => {
  const legacy = parseEditable({
    amountCents: 1850,
    date: "2026-11-23",
    merchant: "食堂",
    category: "食堂",
    note: "味道一般",
  });
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.equal(legacy.value.category, "食堂");
  assert.equal(legacy.value.note, "味道一般");
  assert.equal(entryDescription(legacy.value), "食堂 味道一般");

  const custom = parseEditable({ amountCents: 3000, date: "2026-11-23", merchant: "理发", category: "  理发  " });
  assert.equal(custom.ok, true);
  if (!custom.ok) return;
  assert.equal(custom.value.category, "理发");
  assert.equal(custom.value.merchant, "理发");

  const untagged = parseEditable({ amountCents: 3500, date: "2026-11-23", note: "买书", category: "" });
  assert.equal(untagged.ok, true);
  if (!untagged.ok) return;
  assert.equal(untagged.value.merchant, "买书");
  assert.equal(untagged.value.category, "");
  assert.equal(untagged.value.note, "买书");

  const tagOnly = parseEditable({ amountCents: 800, date: "2026-11-23", category: "交通" });
  assert.equal(tagOnly.ok, true);
  if (!tagOnly.ok) return;
  assert.equal(tagOnly.value.merchant, "交通");
  assert.equal(tagOnly.value.note, "");

  const missing = parseEditable({ amountCents: 800, date: "2026-11-23", merchant: "  ", category: null, note: "" });
  assert.equal(missing.ok, false);

  const longTag = parseEditable({ amountCents: 800, date: "2026-11-23", merchant: "东西", category: "标".repeat(21) });
  assert.equal(longTag.ok, false);
  if (longTag.ok) return;
  assert.equal(longTag.reason, "标签最多 20 个字");
});

test("long notes stay intact while merchant keeps the database prefix", () => {
  const text = "书".repeat(50);
  const split = splitDescription(text, "");
  assert.equal(split.ok, true);
  if (!split.ok) return;
  assert.equal(split.merchant, "书".repeat(40));
  assert.equal(split.note, text);
  assert.equal(split.category, "");
  assert.equal(entryDescription(split), text);

  const short = splitDescription("买书", "书");
  assert.equal(short.ok, true);
  if (!short.ok) return;
  assert.deepEqual({ merchant: short.merchant, note: short.note, category: short.category }, {
    merchant: "买书",
    note: "",
    category: "书",
  });
});
