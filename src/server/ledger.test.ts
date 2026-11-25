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

test("weekly recap accepts the ingest bearer token without a session", async () => {
  const cookie = await ownerCookie();
  await call(
    handlers.createTransaction,
    "/api/transactions",
    { method: "POST", body: JSON.stringify({ amountCents: 1000, date: "2026-11-23", merchant: "食堂", category: "食堂" }) },
    cookie,
  );

  const wrongToken = await call(handlers.getRecap, "/api/recap?anchor=2026-11-23", {
    headers: { authorization: "Bearer not-the-ingest-token" },
  });
  assert.equal(wrongToken.status, 401);

  const withToken = await call(handlers.getRecap, "/api/recap?anchor=2026-11-23", {
    headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
  });
  assert.equal(withToken.status, 200);
  const summary = withToken.body as { expenseCents: number; netCents: number };
  assert.equal(summary.expenseCents, 1000);
  assert.equal(summary.netCents, 1000);
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

test("ingest accepts an explicit custom tag", async () => {
  const auth = { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` };
  const tagged = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "橘子 10.5", category: "拼多多", externalId: "msg-tag-1" }),
  });
  assert.equal(tagged.status, 201);
  const tx = (
    tagged.body as { transaction: { merchant: string; category: string; amountCents: number } }
  ).transaction;
  assert.equal(tx.merchant, "橘子");
  assert.equal(tx.category, "拼多多");
  assert.equal(tx.amountCents, 1050);

  const override = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "食堂 12", category: "拼多多", externalId: "msg-tag-2" }),
  });
  assert.equal(override.status, 201);
  assert.equal((override.body as { transaction: { category: string } }).transaction.category, "拼多多");

  const tagOnly = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "10.5", category: "拼多多", externalId: "msg-tag-3" }),
  });
  assert.equal(tagOnly.status, 201);
  assert.equal((tagOnly.body as { transaction: { merchant: string } }).transaction.merchant, "拼多多");

  const tooLong = await call(handlers.ingest, "/api/ingest", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "橘子 10.5", category: "标".repeat(21), externalId: "msg-tag-4" }),
  });
  assert.equal(tooLong.status, 400);
});

test("custom tags, untagged rows, and free-form ingest survive the schema", async () => {
  const cookie = await ownerCookie();
  await db.query("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_category_length_check");
  await db.query(
    "ALTER TABLE transactions ADD CONSTRAINT transactions_category_legacy_check CHECK (category IN ('食堂', '其他餐饮', '交通', '购物', '其他'))",
  );
  try {
    await db.query(
      `INSERT INTO transactions (id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at)
       VALUES ('legacyrow1', 1800, '2026-11-23', '食堂', '食堂', '味道一般', NULL, '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z')`,
    );
    await assert.rejects(() =>
      db.query(
        `INSERT INTO transactions (id, amount_cents, spent_on, merchant, category, note, external_id, created_at, updated_at)
         VALUES ('blockedrow', 3500, '2026-11-23', '买书', '', '', NULL, '2026-11-23T00:00:00.000Z', '2026-11-23T00:00:00.000Z')`,
      ),
    );
    await db.applySchema();

    const legacy = await db.query<{ merchant: string; note: string; category: string }>(
      "SELECT merchant, note, category FROM transactions WHERE id = 'legacyrow1'",
    );
    assert.deepEqual(legacy, [{ merchant: "食堂", note: "味道一般", category: "食堂" }]);

    const book = await call(
      handlers.createTransaction,
      "/api/transactions",
      { method: "POST", body: JSON.stringify({ amountCents: 3500, date: "2026-11-23", note: "买书", category: "" }) },
      cookie,
    );
    assert.equal(book.status, 201);
    assert.equal((book.body as { transaction: { category: string; merchant: string } }).transaction.category, "");
    assert.equal((book.body as { transaction: { merchant: string } }).transaction.merchant, "买书");

    const haircut = await call(
      handlers.createTransaction,
      "/api/transactions",
      { method: "POST", body: JSON.stringify({ amountCents: 3000, date: "2026-11-24", merchant: "理发", category: "理发" }) },
      cookie,
    );
    assert.equal(haircut.status, 201);
    const longNote = "书".repeat(50);
    const noted = await call(
      handlers.createTransaction,
      "/api/transactions",
      { method: "POST", body: JSON.stringify({ amountCents: 2600, date: "2026-11-24", note: longNote, category: "书" }) },
      cookie,
    );
    assert.equal(noted.status, 201);
    const notedBody = (noted.body as { transaction: { merchant: string; note: string; category: string } }).transaction;
    assert.equal(notedBody.category, "书");
    assert.equal(notedBody.note, longNote);
    assert.equal(notedBody.merchant, "书".repeat(40));

    const tooLong = await call(
      handlers.createTransaction,
      "/api/transactions",
      { method: "POST", body: JSON.stringify({ amountCents: 100, date: "2026-11-24", merchant: "超长", category: "标".repeat(21) }) },
      cookie,
    );
    assert.equal(tooLong.status, 400);

    const byTag = await call(handlers.listTransactions, "/api/transactions?category=" + encodeURIComponent("理发"), {}, cookie);
    assert.deepEqual(
      (byTag.body as { transactions: { merchant: string }[] }).transactions.map((item) => item.merchant),
      ["理发"],
    );
    const untagged = await call(handlers.listTransactions, "/api/transactions?untagged=1", {}, cookie);
    assert.deepEqual(
      (untagged.body as { transactions: { merchant: string }[] }).transactions.map((item) => item.merchant),
      ["买书"],
    );

    const recap = await call(handlers.getRecap, "/api/recap?anchor=2026-11-23", {}, cookie);
    const names = (recap.body as { categories: { category: string; sharePercent: number }[] }).categories.map(
      (item) => item.category,
    );
    assert.deepEqual(names, ["食堂", "理发", "书", ""]);

    const spoken = await call(handlers.ingest, "/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
      body: JSON.stringify({ text: "买书 35", externalId: "msg-book" }),
    });
    assert.equal(spoken.status, 201);
    const spokenBody = (spoken.body as { transaction: { amountCents: number; merchant: string; category: string } }).transaction;
    assert.equal(spokenBody.amountCents, 3500);
    assert.equal(spokenBody.merchant, "买书");
    assert.equal(spokenBody.category, "");
    const hairSpoken = await call(handlers.ingest, "/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
      body: JSON.stringify({ text: "理发 30" }),
    });
    assert.equal(hairSpoken.status, 201);
    assert.equal((hairSpoken.body as { transaction: { category: string; merchant: string } }).transaction.category, "");
    assert.equal((hairSpoken.body as { transaction: { merchant: string } }).transaction.merchant, "理发");

    const vagueAmount = await call(handlers.ingest, "/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.LEDGER_INGEST_TOKEN}` },
      body: JSON.stringify({ text: "18" }),
    });
    assert.equal(vagueAmount.status, 409);
    const reasons = (vagueAmount.body as { reasons: string[] }).reasons;
    assert.equal(reasons.includes("没有识别到分类"), false);
    assert.equal(reasons.includes("写一句说明，或选一个标签"), true);

    await db.applySchema();
    const checks = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'transactions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%category%'`,
    );
    assert.equal(checks.some((item) => item.definition.includes("category IN")), false);
    assert.equal(checks.some((item) => item.definition.includes("char_length(category)")), true);
    const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions");
    assert.equal(Number(count[0].count) >= 4, true);
  } finally {
    await db.applySchema();
  }
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
