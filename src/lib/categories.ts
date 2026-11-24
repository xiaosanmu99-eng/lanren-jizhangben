import { STARTER_TAGS, type StarterTag } from "@/lib/types";

export const UNTAGGED_LABEL = "无标签";

export const STARTER_TAG_COLOR: Record<StarterTag, string> = {
  食堂: "#C24B24",
  其他餐饮: "#C47A2C",
  交通: "#3C6E8F",
  购物: "#6C4E86",
  其他: "#7A7066",
};

const CUSTOM_TAG_COLORS = [
  "#A65D3F",
  "#8C6239",
  "#9C4A3C",
  "#6B5344",
  "#B85C38",
  "#7D4E57",
  "#5E4A3A",
  "#8A5A44",
  "#A34B3C",
  "#6E4B3A",
  "#9A6A3C",
  "#704838",
];

const UNTAGGED_COLOR = "#A89888";
const STARTER = new Set<string>(STARTER_TAGS);

export function tagLabel(tag: string): string {
  const cleaned = tag.trim();
  return cleaned || UNTAGGED_LABEL;
}

export function tagColor(tag: string): string {
  const cleaned = tag.trim();
  if (!cleaned) return UNTAGGED_COLOR;
  if (cleaned in STARTER_TAG_COLOR) return STARTER_TAG_COLOR[cleaned as StarterTag];
  let hash = 0;
  for (const char of cleaned) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return CUSTOM_TAG_COLORS[hash % CUSTOM_TAG_COLORS.length];
}

export const CATEGORY_RULES: { category: StarterTag; words: string[] }[] = [
  { category: "食堂", words: ["食堂"] },
  {
    category: "其他餐饮",
    words: [
      "其他餐饮",
      "早餐",
      "午饭",
      "午餐",
      "晚饭",
      "晚餐",
      "早饭",
      "夜宵",
      "外卖",
      "咖啡",
      "奶茶",
      "餐饮",
      "吃饭",
      "零食",
      "甜品",
      "饮料",
    ],
  },
  {
    category: "交通",
    words: ["地铁", "公交", "打车", "出租车", "出租", "滴滴", "高铁", "火车", "机票", "交通", "单车", "加油"],
  },
  { category: "购物", words: ["超市", "淘宝", "京东", "拼多多", "购物", "日用品"] },
  { category: "其他", words: ["其他"] },
];

export function tagsInLedger(items: { category: string }[]): string[] {
  const present = new Set<string>();
  for (const item of items) {
    const tag = item.category.trim();
    if (tag) present.add(tag);
  }
  const starter = STARTER_TAGS.filter((tag) => present.has(tag));
  const custom = [...present].filter((tag) => !STARTER.has(tag)).sort((left, right) => left.localeCompare(right, "zh-CN"));
  return [...starter, ...custom];
}

export function hasUntagged(items: { category: string }[]): boolean {
  return items.some((item) => !item.category.trim());
}
