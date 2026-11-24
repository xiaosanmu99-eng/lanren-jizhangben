export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-ledger-request", "1");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? "没能完成", data);
  }
  return data as T;
}
