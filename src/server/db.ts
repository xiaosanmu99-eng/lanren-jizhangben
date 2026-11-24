import { Pool, type QueryResultRow } from "pg";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("数据库还没配置");
  }
}

let pool: Pool | null = null;
let migrated = false;

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function getPool(): Pool {
  const connectionString = databaseUrl();
  if (!connectionString) throw new DatabaseNotConfiguredError();
  if (!pool) {
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 8000 });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGSERIAL PRIMARY KEY,
    ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0 AND amount_cents BETWEEN -99999999 AND 99999999),
    spent_on TEXT NOT NULL CHECK (spent_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    merchant TEXT NOT NULL CHECK (char_length(merchant) BETWEEN 1 AND 40),
    category TEXT NOT NULL CHECK (category IN ('食堂', '其他餐饮', '交通', '购物', '其他')),
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 80),
    external_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS transactions_spent_on_idx ON transactions (spent_on DESC)`,
];

export async function ensureReady(): Promise<void> {
  if (migrated) return;
  for (const statement of STATEMENTS) await query(statement);
  migrated = true;
}

export async function resetAllDataForTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset production data");
  await ensureReady();
  await query("TRUNCATE TABLE transactions, sessions, login_attempts, owner RESTART IDENTITY");
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
