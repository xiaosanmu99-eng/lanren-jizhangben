import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEntry } from "./parse.ts";

const today = "2026-11-23";

test("clear canteen, food, transit, and shopping lines are deterministic", () => {
  const canteen = parseEntry("食堂 18.50", today);
  assert.equal(canteen.status, "ready");
  assert.equal(canteen.draft.amountCents, 1850);
  assert.equal(canteen.draft.category, "食堂");
  assert.equal(canteen.draft.merchant, "食堂");
  assert.equal(canteen.draft.date, today);

  const lunch = parseEntry("午饭 25.5", today);
  assert.equal(lunch.status, "ready");
  assert.equal(lunch.draft.amountCents, 2550);
  assert.equal(lunch.draft.category, "其他餐饮");

  const metro = parseEntry("地铁4元", today);
  assert.equal(metro.status, "ready");
  assert.equal(metro.draft.amountCents, 400);
  assert.equal(metro.draft.category, "交通");

  const shop = parseEntry("超市 ¥36.8", today);
  assert.equal(shop.status, "ready");
  assert.equal(shop.draft.amountCents, 3680);
  assert.equal(shop.draft.category, "购物");
});

test("refund words and a leading minus are stored as negative cents once", () => {
  const word = parseEntry("退款 食堂 12", today);
  assert.equal(word.status, "ready");
  assert.equal(word.draft.amountCents, -1200);
  assert.equal(word.draft.refund, true);

  const minus = parseEntry("-12 地铁", today);
  assert.equal(minus.status, "ready");
  assert.equal(minus.draft.amountCents, -1200);
  assert.equal(minus.draft.category, "交通");

  const both = parseEntry("退款 -12 食堂", today);
  assert.equal(both.status, "ready");
  assert.equal(both.draft.amountCents, -1200);
});

test("dates are civil Shanghai dates and do not become amounts", () => {
  const yesterday = parseEntry("昨天 食堂 15", today);
  assert.equal(yesterday.status, "ready");
  assert.equal(yesterday.draft.date, "2026-11-22");
  assert.equal(yesterday.draft.amountCents, 1500);

  const explicit = parseEntry("2026-11-01 交通 6", today);
  assert.equal(explicit.status, "ready");
  assert.equal(explicit.draft.date, "2026-11-01");
  assert.equal(explicit.draft.amountCents, 600);

  const monthDay = parseEntry("11月1日 公交 3", today);
  assert.equal(monthDay.status, "ready");
  assert.equal(monthDay.draft.date, "2026-11-01");
  assert.equal(monthDay.draft.amountCents, 300);
});

test("ambiguous lines stay unconfirmed and do not invent a category or rounded amount", () => {
  const onlyAmount = parseEntry("18", today);
  assert.equal(onlyAmount.status, "needs_confirmation");
  assert.ok(onlyAmount.reasons.includes("missing_category"));
  assert.equal(onlyAmount.draft.amountCents, 1800);

  const noAmount = parseEntry("食堂", today);
  assert.ok(noAmount.reasons.includes("missing_amount"));

  const many = parseEntry("食堂 12 地铁 4", today);
  assert.ok(many.reasons.includes("multiple_amounts"));
  assert.ok(many.reasons.includes("multiple_categories"));
  assert.equal(many.draft.amountCents, null);

  const precise = parseEntry("12.345 食堂", today);
  assert.ok(precise.reasons.includes("excess_precision"));
  assert.equal(precise.draft.amountCents, null);

  const zero = parseEntry("食堂 0", today);
  assert.ok(zero.reasons.includes("zero_amount"));

  const scientific = parseEntry("食堂 1e2", today);
  assert.equal(scientific.status, "needs_confirmation");
  assert.equal(scientific.draft.amountCents, null);
});

test("the same sentence always parses the same way", () => {
  const first = parseEntry("公司楼下食堂 18 味道一般", today);
  const second = parseEntry("公司楼下食堂 18 味道一般", today);
  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  assert.equal(first.draft.category, "食堂");
  assert.equal(first.draft.merchant, "公司楼下食堂 味道一般");
});

test("empty text is not an error", () => {
  assert.equal(parseEntry("   ", today).status, "empty");
});
