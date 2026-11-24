import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, monthRange, shanghaiToday, weekRange } from "./dates.ts";
import { shareTenths, summarizeWeek } from "./week.ts";

test("Shanghai calendar date does not follow UTC", () => {
  assert.equal(shanghaiToday(new Date("2026-11-22T16:30:00Z")), "2026-11-23");
  assert.equal(shanghaiToday(new Date("2026-11-22T15:59:00Z")), "2026-11-22");
});

test("weeks start Monday and Sunday stays in the previous week", () => {
  assert.deepEqual(weekRange("2026-11-23"), {
    start: "2026-11-23",
    end: "2026-11-29",
    days: [
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ],
  });
  assert.equal(weekRange("2026-11-22").start, "2026-11-16");
  assert.equal(weekRange("2026-11-22").end, "2026-11-22");
  assert.equal(addDays("2026-11-23", -1), "2026-11-22");
  assert.deepEqual(monthRange("2026-11-23"), { start: "2026-11-01", end: "2026-11-30" });
});

test("category shares use cents and sum to 100 percent", () => {
  const tenths = shareTenths([1000, 500, 0, 0, 0]);
  assert.deepEqual(tenths, [667, 333, 0, 0, 0]);
  assert.equal(tenths.reduce((sum, value) => sum + value, 0), 1000);
  const even = shareTenths([1, 1, 1]);
  assert.equal(even.reduce((sum, value) => sum + value, 0), 1000);
});

test("weekly net subtracts refunds and does not let refunds inflate the share", () => {
  const summary = summarizeWeek("2026-11-23", [
    { amountCents: 1000, date: "2026-11-23", category: "食堂" },
    { amountCents: -200, date: "2026-11-23", category: "食堂" },
    { amountCents: 500, date: "2026-11-24", category: "交通" },
    { amountCents: 9999, date: "2026-11-16", category: "购物" },
  ]);
  assert.equal(summary.expenseCents, 1500);
  assert.equal(summary.refundCents, 200);
  assert.equal(summary.netCents, 1300);
  assert.equal(summary.days[0].netCents, 800);
  assert.equal(summary.days[1].netCents, 500);
  assert.equal(summary.categories[0].sharePercent, 66.7);
  assert.equal(summary.categories[2].sharePercent, 33.3);
  assert.equal(
    summary.categories.reduce((sum, category) => sum + category.sharePercent, 0),
    100,
  );
});
