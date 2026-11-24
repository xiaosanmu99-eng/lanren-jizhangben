export const MAX_CENTS = 99_999_999;

export type YuanError = "empty" | "format" | "precision" | "zero" | "range";

export function yuanToCents(
  input: string,
): { ok: true; cents: number } | { ok: false; reason: YuanError } {
  const source = input.trim();
  if (!source) return { ok: false, reason: "empty" };
  if (!/^\d{1,6}(?:\.\d+)?$/.test(source)) return { ok: false, reason: "format" };
  const [whole, fraction = ""] = source.split(".");
  if (fraction.length > 2) return { ok: false, reason: "precision" };
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    return { ok: false, reason: "range" };
  }
  if (cents === 0) return { ok: false, reason: "zero" };
  return { ok: true, cents };
}

export function isStoredCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value !== 0 &&
    value >= -MAX_CENTS &&
    value <= MAX_CENTS
  );
}

export function coerceCents(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error("金额不是整数分");
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function formatYuan(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

export function yuanInputFromCents(cents: number): string {
  const absolute = Math.abs(cents);
  return `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
