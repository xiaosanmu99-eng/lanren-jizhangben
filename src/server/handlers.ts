import { randomUUID } from "node:crypto";
import { planImport, toBackup } from "@/lib/backup";
import { isValidYmd, shanghaiToday } from "@/lib/dates";
import { parseEntry, REASON_TEXT } from "@/lib/parse";
import { parseEditable } from "@/lib/record";
import { CATEGORIES, type Category, type Transaction } from "@/lib/types";
import { summarizeWeek } from "@/lib/week";
import { coerceCents, sumCents } from "@/lib/money";
import {
  clearAttempts,
  clientIp,
  configuredSecret,
  createSession,
  deleteSession,
  hashPassword,
  ownerExists,
  passwordError,
  readSession,
  recordAttempt,
  safeEqual,
  tooManyAttempts,
  verifyPassword,
} from "@/server/auth";
import { ensureReady, query } from "@/server/db";
import {
  accessNotice,
  HttpError,
  json,
  originDenied,
  readCookie,
  readJson,
  requireUser,
  sessionCookie,
  withErrors,
  withIdErrors,
} from "@/server/http";

type Row = {
  id: string;
  amount_cents: number | string;
  spent_on: string;
  merchant: string;
  category: Category;
  note: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at";

function toTransaction(row: Row): Transaction {
  return {
    id: row.id,
    amountCents: coerceCents(row.amount_cents),
    date: row.spent_on,
    merchant: row.merchant,
    category: row.category,
    note: row.note,
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function guardMutation(request: Request): Promise<Response | null> {
  await ensureReady();
  const denied = originDenied(request);
  if (denied) return denied;
  return requireUser(request);
}

export const getSession = withErrors(async (request) => {
  await ensureReady();
  const notice = accessNotice(request.headers.get("host"));
  const exists = await ownerExists();
  const authenticated = await readSession(readCookie(request, "ledger_session"));
  return json({
    authenticated,
    ownerExists: exists,
    setupAvailable: !exists && configuredSecret("LEDGER_SETUP_TOKEN") !== null,
    today: shanghaiToday(),
    timeZone: "Asia/Shanghai",
    scope: notice.scope,
    notice: notice.notice,
    ingestionConfigured: configuredSecret("LEDGER_INGEST_TOKEN") !== null,
    scheduleConfigured: false,
  });
});

export const login = withErrors(async (request) => {
  await ensureReady();
  const denied = originDenied(request);
  if (denied) return denied;
  if (!(await ownerExists())) throw new HttpError(409, "还没有账本，需要先完成设置");
  const ip = clientIp(request);
  if (await tooManyAttempts(ip)) throw new HttpError(429, "试得太勤了，请稍后再来");
  const body = (await readJson(request)) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  const rows = await query<{ password_hash: string }>("SELECT password_hash FROM owner WHERE id = 1");
  const matches = rows[0] ? await verifyPassword(password, rows[0].password_hash) : false;
  if (!matches) {
    await recordAttempt(ip);
    throw new HttpError(401, "口令不对");
  }
  await clearAttempts(ip);
  const token = await createSession();
  return json({ authenticated: true }, 200, { "set-cookie": sessionCookie(token, request, 60 * 60 * 24 * 30) });
});

export const logout = withErrors(async (request) => {
  await ensureReady();
  const denied = originDenied(request);
  if (denied) return denied;
  await deleteSession(readCookie(request, "ledger_session"));
  return json({ authenticated: false }, 200, { "set-cookie": sessionCookie("", request, 0) });
});

export const setup = withErrors(async (request) => {
  await ensureReady();
  const denied = originDenied(request);
  if (denied) return denied;
  if (await ownerExists()) throw new HttpError(409, "账本已经设置过了");
  const secret = configuredSecret("LEDGER_SETUP_TOKEN");
  if (!secret) throw new HttpError(503, "配置口令还没在服务器设好");
  const ip = clientIp(request);
  if (await tooManyAttempts(ip)) throw new HttpError(429, "试得太勤了，请稍后再来");
  const body = (await readJson(request)) as { setupToken?: unknown; password?: unknown };
  const supplied = typeof body.setupToken === "string" ? body.setupToken : "";
  if (!supplied || !safeEqual(supplied, secret)) {
    await recordAttempt(ip);
    throw new HttpError(403, "配置口令不对");
  }
  const problem = passwordError(body.password);
  if (problem) throw new HttpError(400, problem);
  const hash = await hashPassword(body.password as string);
  try {
    await query("INSERT INTO owner (id, password_hash, created_at) VALUES (1, $1, $2)", [
      hash,
      new Date().toISOString(),
    ]);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") throw new HttpError(409, "账本已经设置过了");
    throw error;
  }
  await clearAttempts(ip);
  const token = await createSession();
  return json({ authenticated: true }, 201, { "set-cookie": sessionCookie(token, request, 60 * 60 * 24 * 30) });
});

export const listTransactions = withErrors(async (request) => {
  const denied = await guardRead(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  if (category && !CATEGORIES.includes(category as Category)) throw new HttpError(400, "分类不在可选范围里");
  if ((from && !isValidYmd(from)) || (to && !isValidYmd(to))) throw new HttpError(400, "日期无效");
  if ([...keyword].length > 40) throw new HttpError(400, "搜索太长了");
  const pattern = keyword ? `%${keyword.replace(/[\\%_]/g, (mark) => `\\${mark}`)}%` : null;
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM transactions
     WHERE ($1::text IS NULL OR category = $1)
       AND ($2::text IS NULL OR spent_on >= $2)
       AND ($3::text IS NULL OR spent_on <= $3)
       AND (
         $4::text IS NULL
         OR merchant ILIKE $4 ESCAPE '\\'
         OR note ILIKE $4 ESCAPE '\\'
         OR category ILIKE $4 ESCAPE '\\'
       )
     ORDER BY spent_on DESC, created_at DESC, id DESC
     LIMIT 5001`,
    [category, from, to, pattern],
  );
  const truncated = rows.length > 5000;
  const transactions = rows.slice(0, 5000).map(toTransaction);
  return json({ transactions, truncated, totalCents: sumCents(transactions.map((item) => item.amountCents)) });
});

export const createTransaction = withErrors(async (request) => {
  const denied = await guardMutation(request);
  if (denied) return denied;
  const editable = parseEditable(await readJson(request));
  if (!editable.ok) throw new HttpError(400, editable.reason);
  const now = new Date().toISOString();
  const rows = await query<Row>(
    `INSERT INTO transactions (id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)
     RETURNING ${COLUMNS}`,
    [
      randomUUID(),
      editable.value.amountCents,
      editable.value.date,
      editable.value.merchant,
      editable.value.category,
      editable.value.note,
      now,
    ],
  );
  return json({ transaction: toTransaction(rows[0]) }, 201);
});

export const updateTransaction = withIdErrors(async (request, context) => {
  const denied = await guardMutation(request);
  if (denied) return denied;
  const { id } = await context.params;
  const editable = parseEditable(await readJson(request));
  if (!editable.ok) throw new HttpError(400, editable.reason);
  const rows = await query<Row>(
    `UPDATE transactions
     SET amount_cents = $2, spent_on = $3, merchant = $4, category = $5, note = $6, updated_at = $7
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      editable.value.amountCents,
      editable.value.date,
      editable.value.merchant,
      editable.value.category,
      editable.value.note,
      new Date().toISOString(),
    ],
  );
  if (!rows[0]) throw new HttpError(404, "没有这笔账");
  return json({ transaction: toTransaction(rows[0]) });
});

export const clearTransactions = withErrors(async (request) => {
  const denied = await guardMutation(request);
  if (denied) return denied;
  const body = (await readJson(request)) as { confirm?: unknown };
  if (body.confirm !== "清空") throw new HttpError(400, "要清空的话，请输入清空");
  await query("DELETE FROM transactions");
  return json({ deleted: true });
});

export const deleteTransaction = withIdErrors(async (request, context) => {
  const denied = await guardMutation(request);
  if (denied) return denied;
  const { id } = await context.params;
  const rows = await query<{ id: string }>("DELETE FROM transactions WHERE id = $1 RETURNING id", [id]);
  if (!rows[0]) throw new HttpError(404, "没有这笔账");
  return json({ deleted: true });
});

export const exportBackup = withErrors(async (request) => {
  const denied = await guardRead(request);
  if (denied) return denied;
  const rows = await query<Row>(`SELECT ${COLUMNS} FROM transactions ORDER BY spent_on ASC, created_at ASC, id ASC`);
  const today = shanghaiToday();
  const filename = encodeURIComponent(`懒人记账本-备份-${today}.json`);
  return new Response(JSON.stringify(toBackup(rows.map(toTransaction), new Date().toISOString()), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="ledger-backup-${today}.json"; filename*=UTF-8''${filename}`,
    },
  });
});

export const importBackup = withErrors(async (request) => {
  const denied = await guardMutation(request);
  if (denied) return denied;
  const body = (await readJson(request)) as { backup?: unknown; commit?: unknown; includeSuspects?: unknown };
  const existing = await query<Row>(`SELECT ${COLUMNS} FROM transactions`);
  const plan = planImport(existing.map(toTransaction), body.backup);
  if (!body.commit) return json(publicReport(plan, 0, false));
  const selected = body.includeSuspects === true ? [...plan.fresh, ...plan.suspectRecords] : plan.fresh;
  let inserted = 0;
  for (const record of selected) {
    try {
      await query(
        `INSERT INTO transactions (id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.id,
          record.amountCents,
          record.date,
          record.merchant,
          record.category,
          record.note,
          record.externalId,
          record.createdAt,
          new Date().toISOString(),
        ],
      );
      inserted += 1;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "23505") continue;
      throw error;
    }
  }
  return json(publicReport(plan, inserted, true));
});

export const getRecap = withErrors(async (request) => {
  const denied = await guardRead(request);
  if (denied) return denied;
  const anchor = new URL(request.url).searchParams.get("anchor") ?? shanghaiToday();
  if (!isValidYmd(anchor)) throw new HttpError(400, "日期无效");
  const summary = summarizeWeek(anchor, []);
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM transactions WHERE spent_on >= $1 AND spent_on <= $2`,
    [summary.start, summary.end],
  );
  return json(summarizeWeek(anchor, rows.map(toTransaction)));
});

export const ingest = withErrors(async (request) => {
  await ensureReady();
  const secret = configuredSecret("LEDGER_INGEST_TOKEN");
  if (!secret) throw new HttpError(503, "记账入口还没配置");
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !safeEqual(supplied, secret)) throw new HttpError(401, "记账入口拒绝了这个请求");
  const body = (await readJson(request)) as { text?: unknown; externalId?: unknown };
  if (typeof body.text !== "string" || body.text.trim().length === 0 || [...body.text].length > 200) {
    throw new HttpError(400, "缺少要记的那句话");
  }
  const externalId =
    body.externalId == null || body.externalId === ""
      ? null
      : typeof body.externalId === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(body.externalId)
        ? body.externalId
        : undefined;
  if (externalId === undefined) throw new HttpError(400, "外部编号格式不对");
  if (externalId) {
    const existing = await query<Row>(`SELECT ${COLUMNS} FROM transactions WHERE external_id = $1`, [externalId]);
    if (existing[0]) return json({ status: "duplicate", duplicate: true, transaction: toTransaction(existing[0]) });
  }
  const parsed = parseEntry(body.text, shanghaiToday());
  if (parsed.status !== "ready" || parsed.draft.amountCents == null || !parsed.draft.category || !parsed.draft.date) {
    return json(
      {
        status: "needs_confirmation",
        duplicate: false,
        reasons: parsed.reasons.map((reason) => REASON_TEXT[reason]),
        draft: parsed.draft,
      },
      409,
    );
  }
  const now = new Date().toISOString();
  const rows = await query<Row>(
    `INSERT INTO transactions (id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING ${COLUMNS}`,
    [
      randomUUID(),
      parsed.draft.amountCents,
      parsed.draft.date,
      parsed.draft.merchant,
      parsed.draft.category,
      "",
      externalId,
      now,
    ],
  );
  return json({ status: "saved", duplicate: false, transaction: toTransaction(rows[0]) }, 201);
});

export const health = withErrors(async () => {
  await ensureReady();
  await query("SELECT 1 AS ok");
  return json({ ok: true, database: "postgres" });
});

async function guardRead(request: Request): Promise<Response | null> {
  await ensureReady();
  return requireUser(request);
}

function publicReport(
  plan: ReturnType<typeof planImport>,
  inserted: number,
  committed: boolean,
) {
  return {
    committed,
    inserted,
    freshCount: plan.freshCount,
    duplicateIds: plan.duplicateIds,
    suspects: plan.suspects,
    invalid: plan.invalid,
  };
}

