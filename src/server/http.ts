import { readSession } from "@/server/auth";
import { shanghaiToday } from "@/lib/dates";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

export function accessNotice(hostHeader: string | null): { scope: "preview" | "hosted"; notice: string } {
  const host = (hostHeader ?? "").split(",")[0]?.trim().replace(/:\d+$/, "") ?? "";
  const preview = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "";
  if (preview) {
    return {
      scope: "preview",
      notice:
        "账写在这台预览服务的数据库里，不在浏览器本地。这个地址微信打不开。聊天记账和每周日 20:00 的复盘都还没接，这里也没有定时任务。",
    };
  }
  return {
    scope: "hosted",
    notice:
      "账写在这个网站连接的数据库里，要登录才看得了。聊天记账和每周日 20:00 的复盘都还没接，这里也没有定时任务。",
  };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, request: Request, maxAge: number): string {
  const secure = requestIsSecure(request) ? "; Secure" : "";
  return `ledger_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  return new URL(request.url).protocol === "https:";
}

export function originDenied(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.split(",")[0]?.trim();
  if (!origin || !host) return json({ error: "请求来源不对" }, 403);
  try {
    if (new URL(origin).host !== host) return json({ error: "请求来源不对" }, 403);
  } catch {
    return json({ error: "请求来源不对" }, 403);
  }
  return null;
}

export async function requireUser(request: Request): Promise<Response | null> {
  if (request.headers.get("x-ledger-request") !== "1") return json({ error: "需要登录" }, 401);
  const ok = await readSession(readCookie(request, "ledger_session"));
  if (!ok) return json({ error: "需要登录" }, 401);
  return null;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "内容不是 JSON");
  }
}

export function todayStamp(): string {
  return shanghaiToday();
}

function handleFailure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const name = error instanceof Error ? error.name : "Error";
  if (name === "DatabaseNotConfiguredError") return json({ error: "数据库还没配置" }, 503);
  const message = error instanceof Error ? error.message : "";
  console.error("ledger_error", message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted"));
  return json({ error: "服务器没能完成这件事" }, 500);
}

export function withErrors(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      return handleFailure(error);
    }
  };
}

export type IdContext = { params: Promise<{ id: string }> };

export function withIdErrors(
  handler: (request: Request, context: IdContext) => Promise<Response>,
): (request: Request, context: IdContext) => Promise<Response> {
  return async (request: Request, context: IdContext) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleFailure(error);
    }
  };
}
