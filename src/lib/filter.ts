import type { Transaction } from "@/lib/types";

export function filterTransactions(
  items: Transaction[],
  query: { tag?: string; untagged?: boolean; from?: string; to?: string; q?: string },
): Transaction[] {
  const keyword = query.q?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (query.untagged) {
      if (item.category.trim()) return false;
    } else if (query.tag && item.category !== query.tag) return false;
    if (query.from && item.date < query.from) return false;
    if (query.to && item.date > query.to) return false;
    if (!keyword) return true;
    return [item.merchant, item.note, item.category].join("\n").toLowerCase().includes(keyword);
  });
}
