// Tiny key-value store on Upstash Redis. It holds one thing: which eve
// session created each Vault session, so the Agentcard webhook can find the
// conversation to notify when the card lands.
//
// `Redis.fromEnv()` reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN,
// or the KV_REST_API_URL / KV_REST_API_TOKEN pair that the Vercel Marketplace
// injects when you add "Upstash for Redis" to the project.

import { Redis } from "@upstash/redis";

let client: Redis | undefined;

function redis(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}

const DAY = 24 * 60 * 60;

/** Remember which eve session minted a Vault session. Expires with the link. */
export async function rememberVaultSession(vaultSessionId: string, eveSessionId: string, ttlSeconds = DAY) {
  await redis().set(`vault:${vaultSessionId}`, eveSessionId, { ex: ttlSeconds });
}

/** The eve session that minted a Vault session, or null if unknown or expired. */
export async function eveSessionFor(vaultSessionId: string): Promise<string | null> {
  return (await redis().get<string>(`vault:${vaultSessionId}`)) ?? null;
}

/** Mark a key as seen without caring whether it was. */
export async function mark(key: string, ttlSeconds = DAY) {
  await redis().set(key, 1, { ex: ttlSeconds });
}

/** True the first time a key is seen; false on every repeat within the window. */
export async function firstTime(key: string, ttlSeconds = DAY): Promise<boolean> {
  const set = await redis().set(key, 1, { nx: true, ex: ttlSeconds });
  return set === "OK";
}
