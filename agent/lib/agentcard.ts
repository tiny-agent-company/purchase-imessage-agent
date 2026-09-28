// Minimal Agentcard API client for the Vault. Exchanges the organization's
// client credentials for an access token and caches it until shortly before
// it expires. The Vault endpoints reject API keys; they need this token.

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

export async function agentcard<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await orgToken()}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Agentcard ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
