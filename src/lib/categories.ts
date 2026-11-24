import type { Category } from "@/lib/types";

export const CATEGORY_COLOR: Record<Category, string> = {
  食堂: "#C24B24",
  其他餐饮: "#C47A2C",
  交通: "#3C6E8F",
  购物: "#6C4E86",
  其他: "#7A7066",
};

export const CATEGORY_RULES: { category: Category; words: string[] }[] = [
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
