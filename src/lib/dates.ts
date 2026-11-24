const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function formatMonthDay(ymd: string): string {
  const [, month, day] = ymd.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function weekRange(ymd: string): { start: string; end: string; days: string[] } {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const days: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return { start: days[0], end: days[6], days };
}

export function monthRange(ymd: string): { start: string; end: string } {
  const [year, month] = ymd.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const cursor = new Date(Date.UTC(year, month, 0));
  const end = cursor.toISOString().slice(0, 10);
  return { start, end };
}
