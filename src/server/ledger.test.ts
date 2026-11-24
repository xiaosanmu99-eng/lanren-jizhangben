import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.DATABASE_URL = "postgresql://ledger@127.0.0.1:5432/ledger_test";
process.env.LEDGER_SETUP_TOKEN = "local-test-setup-token";
process.env.LEDGER_INGEST_TOKEN = "local-test-ingest-token";
process.env.LEDGER_LOGIN_LIMIT = "8";

const PASSWORD = "correct-horse-battery";
let handlers: typeof import("./handlers.ts");
let db: typeof import("./db.ts");

before(async () => {
  handlers = await import("./handlers.ts");
  db = await import("./db.ts");
  await db.resetAllDataForTests();
});

beforeEach(async () => {
  await db.resetAllDataForTests();
});

after(async () => {
  await db.closePool();
});

function call(
  handler: (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>,
  path: string,
  init: RequestInit = {},
  cookie?: string,
) {
  const headers = new Headers(init.headers);
  headers.set("origin", "http://127.0.0.1:43123");
  headers.set("host", "127.0.0.1:43123");
  if (!headers.has("x-ledger-request")) headers.set("x-ledger-request", "1");
  if (cookie) headers.set("cookie", cookie);
  const request = new Request(`http://127.0.0.1:43123${path}`, { ...init, headers });
  const id = path.split("/").filter(Boolean).at(-1) ?? "";
  return handler(request, { params: Promise.resolve({ id }) }).then(async (response) => {
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, headers: response.headers, text };
  });
}

async function ownerCookie() {
  const created = await call(handlers.setup, "/api/setup", {
    method: "POST",
    body: JSON.stringify({ setupToken: process.env.LEDGER_SETUP_TOKEN, password: PASSWORD }),
  });
  assert.equal(created.status, 201);
  const cookie = created.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("ledger_session="));
  assert.match(created.headers.get("set-cookie") ?? "", /HttpOnly/);
  return cookie as string;
}

test("unauthenticated requests get no expense records", async () => {
  const paths = ["/api/transactions", "/api/export", "/api/recap", "/api/import"];
  for (const path of paths) {
    const response = await call(handlers.listTransactions, path);
    const denied =
      path === "/api/transactions"
        ? response
        : await call(
            path === "/api/export" ? handlers.exportBackup : path === "/api/recap" ? handlers.getRecap : handlers.importBackup,
            path,
            path === "/api/import" ? { method: "POST", body: "{}" } : {},
          );
    assert.equal(denied.status, 401);
    assert.deepEqual(denied.body, { error: "需要登录" });
    assert.equal(JSON.stringify(denied.body).includes("amountCents"), false);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  }
  const posted = await call(handlers.createTransaction, "/api/transactions", {
    method: "POST",
    body: JSON.stringify({ amountCents: 100, date: "2026-11-23", merchant: "食堂", category: "食堂" }),
  });
  assert.equal(posted.status, 401);
  const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
  assert.equal(count[0].count, "0");
});

test("setup ignores a token in the URL and then persists money across a new connection", async () => {
  const fromUrl = await call(handlers.setup, "/api/setup?setupToken=local-test-setup-token", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(fromUrl.status, 403);
  const short = await call(handlers.setup, "/api/setup", {
    method: "POST",
    body: JSON.stringify({ setupToken: process.env.LEDGER_SETUP_TOKEN, password: "short" }),
  });
  assert.equal(short.status, 400);

  const cookie = await ownerCookie();
  const again = await call(handlers.setup, "/api/setup", {
    method: "POST",
    body: JSON.stringify({ setupToken: process.env.LEDGER_SETUP_TOKEN, password: PASSWORD }),
  });
  assert.equal(again.status, 409);

  const created = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: 830, date: "2026-11-23", merchant: "持久", category: "食堂", note: "" }),
    },
    cookie,
  );
  assert.equal(created.status, 201);
  const ten = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: 10, date: "2026-11-23", merchant: "一角", category: "其他餐饮" }),
    },
    cookie,
  );
  const twenty = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: 20, date: "2026-11-23", merchant: "两角", category: "其他餐饮" }),
    },
    cookie,
  );
  assert.equal(ten.status, 201);
  assert.equal(twenty.status, 201);
  const refund = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: -1850, date: "2026-11-24", merchant: "退咖啡", category: "其他餐饮" }),
    },
    cookie,
  );
  const repaid = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: 1850, date: "2026-11-24", merchant: "咖啡", category: "其他餐饮" }),
    },
    cookie,
  );
  assert.equal(refund.status, 201);
  assert.equal(repaid.status, 201);

  const fractional = await call(
    handlers.createTransaction,
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({ amountCents: 18.5, date: "2026-11-23", merchant: "坏", category: "食堂" }),
    },
    cookie,
  );
  assert.equal(fractional.status, 400);

  await db.closePool();
  const reopened = await db.query<{ amount_cents: number }>(
    "SELECT amount_cents FROM transactions WHERE merchant = '持久'",
  );
  assert.deepEqual(reopened.map((row) => Number(row.amount_cents)), [830]);

  const listed = await call(handlers.listTransactions, "/api/transactions", {}, cookie);
  assert.equal(listed.status, 200);
  const body = listed.body as { transactions: { amountCents: number; merchant: string }[]; totalCents: number };
  assert.equal(body.transactions.some((item) => item.merchant === "持久" && item.amountCents === 830), true);
  const small = body.transactions.filter((item) => item.merchant === "一角" || item.merchant === "两角");
  assert.equal(small.reduce((sum, item) => sum + item.amountCents, 0), 30);
  const coffee = body.transactions.filter((item) => item.merchant === "咖啡" || item.merchant === "退咖啡");
  assert.equal(coffee.reduce((sum, item) => sum + item.amountCents, 0), 0);

  const durable = body.transactions.find((item) => item.merchant === "持久") as { id: string };
  const updated = await call(
    handlers.updateTransaction,
    `/api/transactions/${durable.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ amountCents: 831, date: "2026-11-23", merchant: "持久改", category: "食堂", note: "改过" }),
    },
    cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal((updated.body as { transaction: { amountCents: number } }).transaction.amountCents, 831);
  const removed = await call(handlers.deleteTransaction, `/api/transactions/${durable.id}`, { method: "DELETE" }, cookie);
  assert.equal(removed.status, 200);
  const afterDelete = await call(handlers.listTransactions, "/api/transactions?q=持久改", {}, cookie);
  assert.equal((afterDelete.body as { transactions: unknown[] }).transactions.length, 0);

  const fake = await call(handlers.listTransactions, "/api/transactions", { headers: { cookie: "ledger_session=nope" } });
  assert.equal(fake.status, 401);
  const noHeader = await call(
    handlers.listTransactions,
    "/api/transactions",
    { headers: { "x-ledger-request": "0", cookie } },
  );
  assert.equal(noHeader.status, 401);
});

test("login, filter, weekly recap, and deduplicated import use the stored cents", async () => {
  await ownerCookie();
  const loggedOut = await call(handlers.logout, "/api/session", { method: "DELETE" });
  assert.equal(loggedOut.status, 200);
  const wrong = await call(handlers.login, "/api/session", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password-value" }),
  });
  assert.equal(wrong.status, 401);
  const logged = await call(handlers.login, "/api/session", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = logged.headers.get("set-cookie")?.split(";")[0] as string;
  assert.equal(logged.status, 200);

  await call(
    handlers.createTransaction,
    "/api/transactions",
    { method: "POST", body: JSON.stringify({ amountCents: 1000, date: "2026-11-23", merchant: "食堂", category: "食堂" }) },
    cookie,
  );
  await call(
    handlers.createTransaction,
    "/api/transactions",
    { method: "POST", body: JSON.stringify({ amountCents: -200, date: "2026-11-23", merchant: "食堂退", category: "食堂" }) },
    cookie,
  );
  await call(
    handlers.createTransaction,
    "/api/transactions",
    { method: "POST", body: JSON.stringify({ amountCents: 500, date: "2026-11-24", merchant: "地铁", category: "交通" }) },
    cookie,
  );

  const filtered = await call(handlers.listTransactions, "/api/transactions?category=交通", {}, cookie);
  const filteredBody = filtered.body as { transactions: { merchant: string }[]; totalCents: number };
  assert.deepEqual(filteredBody.transactions.map((item) => item.merchant), ["地铁"]);
  assert.equal(filteredBody.totalCents, 500);

  const recap = await call(handlers.getRecap, "/api/recap?anchor=2026-11-23", {}, cookie);
  const summary = recap.body as { expenseCents: number; refundCents: number; netCents: number; categories: { sharePercent: number }[] };
  assert.equal(summary.expenseCents, 1500);
  assert.equal(summary.refundCents, 200);
  assert.equal(summary.netCents, 1300);
  assert.equal(summary.categories[0].sharePercent, 66.7);

  const exported = await call(handlers.exportBackup, "/api/export", {}, cookie);
  const backup = exported.body as { transactions: { id: string; amountCents: number }[] };
  assert.equal(backup.transactions.every((item) => Number.isInteger(item.amountCents)), true);
  const preview = await call(handlers.importBackup, "/api/import", {
    method: "POST",
    body: JSON.stringify({ backup, commit: false }),
  }, cookie);
  const previewBody = preview.body as { committed: boolean; duplicateIds: string[]; inserted: number };
  assert.equal(previewBody.committed, false);
  assert.equal(previewBody.inserted, 0);
  assert.equal(previewBody.duplicateIds.length, 3);
  const countBefore = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
  const committed = await call(handlers.importBackup, "/api/import", {
    method: "POST",
    body: JSON.stringify({ backup, commit: true, includeSuspects: true }),
  }, cookie);
  assert.equal((committed.body as { inserted: number }).inserted, 0);
  const countAfter = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
  assert.equal(countAfter[0].count, countBefore[0].count);

  const suspectBackup = {
    app: "懒人记账本",
    schema: 1,
    transactions: [
      {
        id: "suspectitem",
        amountCents: 1000,
        date: "2026-11-23",
        merchant: "食堂",
        category: "食堂",
        note: "",
        externalId: null,
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      },
    ],
  };
  const warned = await call(handlers.importBackup, "/api/import", {
    method: "POST",
    body: JSON.stringify({ backup: suspectBackup, commit: false }),
  }, cookie);
  assert.equal((warned.body as { suspects: unknown[] }).suspects.length, 1);
  const skipped = await call(handlers.importBackup, "/api/import", {
    method: "POST",
    body: JSON.stringify({ backup: suspectBackup, commit: true, includeSuspects: false }),
  }, cookie);
  assert.equal((skipped.body as { inserted: number }).inserted, 0);
  const included = await call(handlers.importBackup, "/api/import", {
    method: "POST",
    body: JSON.stringify({ backup: suspectBackup, commit: true, includeSuspects: true }),
  }, cookie);
  assert.equal((included.body as { inserted: number }).inserted, 1);
});

test("ingest saves only an unambiguous line and does not double insert", async () => {
  const missing = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: { authorization: "Bearer wrong-token-value" },
    body: JSON.stringify({ text: "食堂 18" }),
  });
  assert.equal(missing.status, 401);
  const vague = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
    body: JSON.stringify({ text: "食堂", externalId: "msg-vague" }),
  });
  assert.equal(vague.status, 409);
  assert.equal((vague.body as { status: string }).status, "needs_confirmation");
  const saved = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
    body: JSON.stringify({ text: "食堂 18.50", externalId: "msg-1" }),
  });
  assert.equal(saved.status, 201);
  assert.equal((saved.body as { transaction: { amountCents: number } }).transaction.amountCents, 1850);
  const again = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
    body: JSON.stringify({ text: "食堂 99", externalId: "msg-1" }),
  });
  assert.equal(again.status, 200);
  assert.equal((again.body as { duplicate: boolean; transaction: { amountCents: number } }).duplicate, true);
  assert.equal((again.body as { transaction: { amountCents: number } }).transaction.amountCents, 1850);
  const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
  assert.equal(count[0].count, "1");
});

test("clearing the book requires the confirmation word and a session", async () => {
  const cookie = await ownerCookie();
  await call(
    handlers.createTransaction,
    "/api/transactions",
    { method: "POST", body: JSON.stringify({ amountCents: 100, date: "2026-11-23", merchant: "待清空", category: "其他" }) },
    cookie,
  );
  const anonymous = await call(handlers.clearTransactions, "/api/transactions", {
    method: "DELETE",
    body: JSON.stringify({ confirm: "清空" }),
  });
  assert.equal(anonymous.status, 401);
  const wrong = await call(
    handlers.clearTransactions,
    "/api/transactions",
    { method: "DELETE", body: JSON.stringify({ confirm: "删除" }) },
    cookie,
  );
  assert.equal(wrong.status, 400);
  const cleared = await call(
    handlers.clearTransactions,
    "/api/transactions",
    { method: "DELETE", body: JSON.stringify({ confirm: "清空" }) },
    cookie,
  );
  assert.equal(cleared.status, 200);
  const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
  assert.equal(count[0].count, "0");
});
