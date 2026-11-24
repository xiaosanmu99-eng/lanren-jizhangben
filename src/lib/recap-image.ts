import { formatMonthDay } from "@/lib/dates";
import { formatYuan } from "@/lib/money";
import { CATEGORY_COLOR } from "@/lib/categories";
import type { WeekSummary } from "@/lib/types";

export async function renderRecapPng(summary: WeekSummary): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const width = 360;
  const height = 640;
  const canvas = document.createElement("canvas");
  canvas.width = width * 3;
  canvas.height = height * 3;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("这台浏览器画不出复盘图");
  context.scale(3, 3);
  context.fillStyle = "#F6F0E6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#C24B24";
  context.fillRect(0, 0, width, 8);

  context.fillStyle = "#241910";
  context.font = "600 28px 'Songti SC', 'WenQuanYi Micro Hei', serif";
  context.fillText("懒人记账本", 24, 48);
  context.font = "15px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
  context.fillStyle = "#6E6256";
  context.fillText("肖三木 · 一周复盘", 24, 74);
  context.fillText(`${formatMonthDay(summary.start)} – ${formatMonthDay(summary.end)}`, 24, 96);

  const stats = [
    ["支出", summary.expenseCents],
    ["退款", summary.refundCents],
    ["结余", summary.netCents],
  ] as const;
  stats.forEach(([label, cents], index) => {
    const x = 24 + index * 108;
    context.fillStyle = "#FFFBF5";
    context.beginPath();
    context.roundRect(x, 116, 100, 72, 16);
    context.fill();
    context.fillStyle = "#6E6256";
    context.font = "13px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
    context.fillText(label, x + 12, 140);
    context.fillStyle = cents < 0 ? "#1E6B45" : "#241910";
    context.font = "600 16px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
    context.fillText(formatYuan(cents), x + 12, 166);
  });

  const empty = summary.expenseCents === 0 && summary.refundCents === 0;
  context.fillStyle = "#241910";
  context.font = "600 16px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
  context.fillText(empty ? "这周还没有账" : "分类", 24, 220);

  summary.categories.forEach((category, index) => {
    const y = 236 + index * 36;
    context.fillStyle = "#6E6256";
    context.font = "14px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
    context.fillText(category.category, 24, y + 14);
    context.fillStyle = "#E7D9C6";
    context.beginPath();
    context.roundRect(92, y + 4, 120, 10, 5);
    context.fill();
    context.fillStyle = CATEGORY_COLOR[category.category];
    context.beginPath();
    context.roundRect(92, y + 4, Math.max(category.sharePercent > 0 ? 6 : 0, (category.sharePercent / 100) * 120), 10, 5);
    context.fill();
    context.fillStyle = "#241910";
    context.font = "13px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
    context.textAlign = "right";
    context.fillText(`${formatYuan(category.netCents)} · ${category.sharePercent.toFixed(1)}%`, 336, y + 14);
    context.textAlign = "left";
  });

  context.fillStyle = "#241910";
  context.font = "600 16px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
  context.fillText("每天结余", 24, 440);
  const peak = Math.max(...summary.days.map((day) => Math.abs(day.netCents)), 1);
  summary.days.forEach((day, index) => {
    const x = 28 + index * 46;
    const bar = Math.round((Math.abs(day.netCents) / peak) * 72);
    context.fillStyle = day.netCents < 0 ? "#1E6B45" : "#C24B24";
    context.fillRect(x, 528 - bar, 22, bar);
    context.fillStyle = "#6E6256";
    context.font = "12px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
    context.fillText(day.weekday.replace("周", ""), x, 548);
  });

  context.fillStyle = "#6E6256";
  context.font = "12px 'PingFang SC', 'WenQuanYi Micro Hei', sans-serif";
  context.fillText("数字来自账本记录。没有定时推送。", 24, 612);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("没能生成图片");
  return blob;
}
