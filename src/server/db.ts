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
    category TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 80),
    external_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS transactions_spent_on_idx ON transactions (spent_on DESC)`,
  `ALTER TABLE transactions ALTER COLUMN category SET DEFAULT ''`,
  `DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'transactions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%category%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%char_length(category)%'
  LOOP
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_category_length_check'
  ) THEN
    BEGIN
      ALTER TABLE transactions
        ADD CONSTRAINT transactions_category_length_check
        CHECK (char_length(category) <= 20);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) await query(statement);
}

export async function ensureReady(): Promise<void> {
  if (migrated) return;
  await applySchema();
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
