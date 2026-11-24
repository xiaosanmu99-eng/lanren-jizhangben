import assert from "node:assert/strict";
import { test } from "node:test";
import { coerceCents, formatYuan, sumCents, yuanToCents } from "./money.ts";

test("yuan strings become exact integer cents", () => {
  assert.deepEqual(yuanToCents("0.10"), { ok: true, cents: 10 });
  assert.deepEqual(yuanToCents("0.1"), { ok: true, cents: 10 });
  assert.deepEqual(yuanToCents("0.01"), { ok: true, cents: 1 });
  assert.deepEqual(yuanToCents("8.30"), { ok: true, cents: 830 });
  assert.deepEqual(yuanToCents("18.50"), { ok: true, cents: 1850 });
  assert.deepEqual(yuanToCents("19.99"), { ok: true, cents: 1999 });
  assert.deepEqual(yuanToCents("999999.99"), { ok: true, cents: 99999999 });
});

test("tenths of a yuan do not use binary floats", () => {
  const left = yuanToCents("0.10");
  const right = yuanToCents("0.20");
  assert.equal(left.ok && right.ok && sumCents([left.cents, right.cents]), 30);
  assert.equal(formatYuan(30), "0.30");
});

test("more than two decimal places is rejected instead of rounded", () => {
  assert.deepEqual(yuanToCents("1.005"), { ok: false, reason: "precision" });
  assert.deepEqual(yuanToCents("1.001"), { ok: false, reason: "precision" });
});

test("zero, junk, and oversized amounts are rejected", () => {
  assert.equal(yuanToCents("0").ok, false);
  assert.equal(yuanToCents("0.00").ok, false);
  assert.equal(yuanToCents("").ok, false);
  assert.equal(yuanToCents("1e2").ok, false);
  assert.equal(yuanToCents("18.").ok, false);
  assert.equal(yuanToCents("1000000").ok, false);
});

test("database values stay integers", () => {
  assert.equal(coerceCents(830), 830);
  assert.equal(coerceCents("-1850"), -1850);
  assert.throws(() => coerceCents(18.5));
  assert.equal(sumCents([1850, -1850]), 0);
  assert.equal(sumCents([100, -30]), 70);
  assert.equal(formatYuan(-1850), "-18.50");
});
