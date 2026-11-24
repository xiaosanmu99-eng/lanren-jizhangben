import { fingerprint, parseEditable } from "@/lib/record";
import type { ImportReport, ImportSuspect, Transaction } from "@/lib/types";

export type StoredLike = Pick<Transaction, "id" | "date" | "amountCents" | "category" | "merchant">;

type Incoming = Transaction;

export function planImport(
  existing: StoredLike[],
  backup: unknown,
): ImportReport & { fresh: Incoming[]; suspectRecords: Incoming[] } {
  if (!backup || typeof backup !== "object") {
    return emptyReport([{ index: 0, reason: "备份不是这一版的 JSON" }]);
  }
  const body = backup as Record<string, unknown>;
  if (body.app !== "懒人记账本" || body.schema !== 1 || !Array.isArray(body.transactions)) {
    return emptyReport([{ index: 0, reason: "备份不是这一版的 JSON" }]);
  }
  if (body.transactions.length > 5000) {
    return emptyReport([{ index: 0, reason: "一次最多导入 5000 笔" }]);
  }

  const knownIds = new Set(existing.map((item) => item.id));
  const knownPrints = new Set(existing.map((item) => fingerprint(item)));
  const seenIds = new Set<string>();
  const fresh: Incoming[] = [];
  const suspects: ImportSuspect[] = [];
  const suspectRecords: Incoming[] = [];
  const duplicateIds: string[] = [];
  const invalid: { index: number; reason: string }[] = [];

  body.transactions.forEach((item, index) => {
    const parsed = parseIncoming(item);
    if (!parsed.ok) {
      invalid.push({ index, reason: parsed.reason });
      return;
    }
    if (seenIds.has(parsed.value.id) || knownIds.has(parsed.value.id)) {
      duplicateIds.push(parsed.value.id);
      return;
    }
    seenIds.add(parsed.value.id);
    const print = fingerprint(parsed.value);
    if (knownPrints.has(print)) {
      suspects.push(toSuspect(parsed.value));
      suspectRecords.push(parsed.value);
    } else {
      knownPrints.add(print);
      fresh.push(parsed.value);
    }
  });

  return {
    committed: false,
    inserted: 0,
    freshCount: fresh.length,
    duplicateIds,
    suspects,
    invalid,
    fresh,
    suspectRecords,
  };
}

function parseIncoming(input: unknown): { ok: true; value: Incoming } | { ok: false; reason: string } {
  const editable = parseEditable(input);
  if (!editable.ok) return editable;
  if (!input || typeof input !== "object") return { ok: false, reason: "内容不完整" };
  const body = input as Record<string, unknown>;
  const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.id) ? body.id : crypto.randomUUID();
  const externalId =
    body.externalId == null || body.externalId === ""
      ? null
      : typeof body.externalId === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(body.externalId)
        ? body.externalId
        : undefined;
  if (externalId === undefined) return { ok: false, reason: "外部编号格式不对" };
  const createdAt = typeof body.createdAt === "string" ? body.createdAt : new Date(0).toISOString();
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : createdAt;
  return { ok: true, value: { id, ...editable.value, externalId, createdAt, updatedAt } };
}

function toSuspect(record: Incoming): ImportSuspect {
  return {
    id: record.id,
    date: record.date,
    merchant: record.merchant,
    amountCents: record.amountCents,
    category: record.category,
  };
}

function emptyReport(invalid: { index: number; reason: string }[]): ImportReport & { fresh: Incoming[]; suspectRecords: Incoming[] } {
  return {
    committed: false,
    inserted: 0,
    freshCount: 0,
    duplicateIds: [],
    suspects: [],
    invalid,
    fresh: [],
    suspectRecords: [],
  };
}

export function toBackup(transactions: Transaction[], exportedAt: string) {
  return { app: "懒人记账本" as const, schema: 1 as const, exportedAt, transactions };
}
