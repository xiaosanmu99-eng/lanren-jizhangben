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

test("ambiguous lines stay unconfirmed and do not invent a rounded amount", () => {
  const onlyAmount = parseEntry("18", today);
  assert.equal(onlyAmount.status, "needs_confirmation");
  assert.deepEqual(onlyAmount.reasons, ["missing_merchant"]);
  assert.equal(onlyAmount.draft.category, null);
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

test("free-form sentences are ready without a legacy category", () => {
  const book = parseEntry("买书 35", today);
  assert.equal(book.status, "ready");
  assert.equal(book.draft.amountCents, 3500);
  assert.equal(book.draft.category, null);
  assert.equal(book.draft.merchant, "买书");
  assert.deepEqual(book.reasons, []);

  const haircut = parseEntry("理发 30", today);
  assert.equal(haircut.status, "ready");
  assert.equal(haircut.draft.amountCents, 3000);
  assert.equal(haircut.draft.category, null);
  assert.equal(haircut.draft.merchant, "理发");

  const refund = parseEntry("退款 理发 30", today);
  assert.equal(refund.status, "ready");
  assert.equal(refund.draft.amountCents, -3000);
  assert.equal(refund.draft.merchant, "理发");
  assert.equal(refund.draft.category, null);
});

test("a known keyword only suggests a tag and does not block other wording", () => {
  const suggested = parseEntry("买书 食堂 35", today);
  assert.equal(suggested.status, "ready");
  assert.equal(suggested.draft.category, "食堂");
  assert.equal(suggested.draft.merchant, "买书 食堂");
  assert.equal(suggested.draft.amountCents, 3500);

  const tooLong = parseEntry(`${"书".repeat(81)} 12`, today);
  assert.equal(tooLong.status, "needs_confirmation");
  assert.ok(tooLong.reasons.includes("description_too_long"));
});
