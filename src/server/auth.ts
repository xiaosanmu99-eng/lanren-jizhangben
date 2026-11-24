import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { query } from "@/server/db";

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(sha256Buffer(left), sha256Buffer(right));
}

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function configuredSecret(name: "LEDGER_SETUP_TOKEN" | "LEDGER_INGEST_TOKEN"): string | null {
  const value = process.env[name] ?? "";
  return value.length >= 16 ? value : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 })) as Buffer;
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const block = Number(parts[2]);
  const parallel = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) return false;
  const actual = (await scryptAsync(password, salt, expected.length, {
    N: cost,
    r: block,
    p: parallel,
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== "string") return "请设置登录口令";
  const length = [...password].length;
  if (length < 10) return "登录口令至少 10 个字符";
  if (length > 128) return "登录口令太长了";
  if (password.trim().length < 10) return "登录口令至少 10 个字符";
  return null;
}

export async function ownerExists(): Promise<boolean> {
  const rows = await query<{ id: number }>("SELECT id FROM owner WHERE id = 1");
  return rows.length > 0;
}

export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await query("INSERT INTO sessions (token_hash, expires_at, created_at) VALUES ($1, $2, $3)", [
    sha256(token),
    new Date(now.getTime() + SESSION_MS).toISOString(),
    now.toISOString(),
  ]);
  return token;
}

export async function readSession(token: string | null): Promise<boolean> {
  if (!token) return false;
  const rows = await query<{ expires_at: string }>("SELECT expires_at FROM sessions WHERE token_hash = $1", [
    sha256(token),
  ]);
  if (!rows[0]) return false;
  if (rows[0].expires_at <= new Date().toISOString()) {
    await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    return false;
  }
  return true;
}

export async function deleteSession(token: string | null): Promise<void> {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "local").slice(0, 64);
}

export async function tooManyAttempts(ip: string): Promise<boolean> {
  const limit = Number(process.env.LEDGER_LOGIN_LIMIT ?? 8);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM login_attempts WHERE ip = $1 AND attempted_at > $2",
    [ip, cutoff],
  );
  return Number(rows[0]?.count ?? 0) >= (Number.isInteger(limit) && limit > 0 ? limit : 8);
}

export async function recordAttempt(ip: string): Promise<void> {
  await query("INSERT INTO login_attempts (ip, attempted_at) VALUES ($1, $2)", [ip, new Date().toISOString()]);
}

export async function clearAttempts(ip: string): Promise<void> {
  await query("DELETE FROM login_attempts WHERE ip = $1", [ip]);
}
