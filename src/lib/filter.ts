import type { Category, Transaction } from "@/lib/types";

export function filterTransactions(
  items: Transaction[],
  query: { category?: Category | ""; from?: string; to?: string; q?: string },
): Transaction[] {
  const keyword = query.q?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (query.category && item.category !== query.category) return false;
    if (query.from && item.date < query.from) return false;
    if (query.to && item.date > query.to) return false;
    if (!keyword) return true;
    return [item.merchant, item.note, item.category].join("\n").toLowerCase().includes(keyword);
  });
}
