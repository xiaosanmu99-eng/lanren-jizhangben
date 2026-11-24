import { weekRange, weekdayLabel } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { STARTER_TAGS, type WeekSummary } from "@/lib/types";

type Spend = { amountCents: number; date: string; category: string };

const STARTER = new Set<string>(STARTER_TAGS);

export function shareTenths(values: number[]): number[] {
  const amounts = values.map((value) => BigInt(value));
  const total = amounts.reduce((sum, value) => sum + value, BigInt(0));
  if (total === BigInt(0)) return values.map(() => 0);
  const floors = amounts.map((value) => Number((value * BigInt(1000)) / total));
  const remainders = amounts.map((value) => (value * BigInt(1000)) % total);
  const leftover = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const order = remainders
    .map((remainder, index) => ({ index, remainder }))
    .sort((left, right) =>
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1,
    );
  for (let step = 0; step < leftover; step += 1) floors[order[step].index] += 1;
  return floors;
}

function tagKey(category: string): string {
  return category.trim();
}

export function summarizeWeek(anchor: string, rows: Spend[]): WeekSummary {
  const week = weekRange(anchor);
  const included = rows.filter((row) => row.date >= week.start && row.date <= week.end);
  const days = week.days.map((date) => {
    const matching = included.filter((row) => row.date === date);
    const expenseCents = sumCents(matching.map((row) => (row.amountCents > 0 ? row.amountCents : 0)));
    const refundCents = sumCents(matching.map((row) => (row.amountCents < 0 ? -row.amountCents : 0)));
    return {
      date,
      weekday: weekdayLabel(date),
      expenseCents,
      refundCents,
      netCents: expenseCents - refundCents,
    };
  });
  const keys = new Set(included.map((row) => tagKey(row.category)));
  const ordered = [
    ...STARTER_TAGS.filter((tag) => keys.has(tag)),
    ...[...keys].filter((tag) => tag && !STARTER.has(tag)).sort((left, right) => left.localeCompare(right, "zh-CN")),
    ...(keys.has("") ? [""] : []),
  ];
  const expenseByCategory = ordered.map((category) =>
    sumCents(
      included
        .filter((row) => tagKey(row.category) === category && row.amountCents > 0)
        .map((row) => row.amountCents),
    ),
  );
  const tenths = shareTenths(expenseByCategory);
  const categories = ordered.map((category, index) => {
    const expenseCents = expenseByCategory[index];
    const refundCents = sumCents(
      included
        .filter((row) => tagKey(row.category) === category && row.amountCents < 0)
        .map((row) => -row.amountCents),
    );
    return {
      category,
      expenseCents,
      refundCents,
      netCents: expenseCents - refundCents,
      sharePercent: tenths[index] / 10,
    };
  });
  const expenseCents = sumCents(days.map((day) => day.expenseCents));
  const refundCents = sumCents(days.map((day) => day.refundCents));
  return {
    start: week.start,
    end: week.end,
    timeZone: "Asia/Shanghai",
    expenseCents,
    refundCents,
    netCents: expenseCents - refundCents,
    days,
    categories,
  };
}
