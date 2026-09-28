// Agentcard API client. Two kinds of bearer:
//   - the ORGANIZATION token (client credentials) creates Vault links, connects
//     users and registers webhooks;
//   - a USER token (from connect/verify) is what /buy runs as, because a
//     purchase is always one person's.

const API_URL = process.env.AGENTCARD_API_URL ?? "https://api.agentcard.sh";

let cached: { token: string; expiresAt: number } | undefined;

export async function orgToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = process.env.AGENTCARD_CLIENT_ID;
  const clientSecret = process.env.AGENTCARD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Set AGENTCARD_CLIENT_ID and AGENTCARD_CLIENT_SECRET");
  }

  const res = await fetch(`${API_URL}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Agentcard token exchange failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export class AgentcardError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Agentcard ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
}

async function call<T>(
  bearer: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* keep the raw text */
  }
  if (!res.ok) throw new AgentcardError(res.status, parsed);
  return parsed as T;
}

/** Call with the organization token. */
export async function agentcard<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  return call<T>(await orgToken(), method, path, body);
}

/** Call as a user. `/buy` turns run against a live merchant, so allow two minutes. */
export async function agentcardAs<T>(
  userToken: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 120_000,
): Promise<T> {
  return call<T>(userToken, method, path, body, timeoutMs);
}

/** True when the org credentials are sandbox ones (the connect code is then fixed). */
export function isSandbox(): boolean {
  return (process.env.AGENTCARD_MODE ?? "sandbox") !== "production";
}
