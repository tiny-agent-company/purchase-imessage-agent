// Small key-value store on Upstash Redis. It holds three things: the eve
// session behind each Vault link (for the webhook), the connect attempt a
// phone number is in the middle of, and the user's connection tokens once
// they verified, so /buy can run as them on every later text.
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

// Several agents can share one database (the free tier has one): each sets
// STORE_PREFIX so their keys never collide.
const PREFIX = process.env.STORE_PREFIX ? `${process.env.STORE_PREFIX}:` : "";
const k = (key: string) => `${PREFIX}${key}`;

const DAY = 24 * 60 * 60;

/** Remember which eve session minted a Vault session. Expires with the link. */
export async function rememberVaultSession(vaultSessionId: string, eveSessionId: string, ttlSeconds = DAY) {
  await redis().set(k(`vault:${vaultSessionId}`), eveSessionId, { ex: ttlSeconds });
}

/** The eve session that minted a Vault session, or null if unknown or expired. */
export async function eveSessionFor(vaultSessionId: string): Promise<string | null> {
  return (await redis().get<string>(k(`vault:${vaultSessionId}`))) ?? null;
}

/** Mark a key as seen without caring whether it was. */
export async function mark(key: string, ttlSeconds = DAY) {
  await redis().set(k(key), 1, { ex: ttlSeconds });
}

/** True the first time a key is seen; false on every repeat within the window. */
export async function firstTime(key: string, ttlSeconds = DAY): Promise<boolean> {
  const set = await redis().set(k(key), 1, { nx: true, ex: ttlSeconds });
  return set === "OK";
}

// ── Connections ──────────────────────────────────────────────────────────

/** The connect attempt a phone is in the middle of; gone after 10 minutes. */
export async function rememberConnectAttempt(phone: string, connectId: string) {
  await redis().set(k(`connect:${phone}`), connectId, { ex: 10 * 60 });
}

export async function connectAttemptFor(phone: string): Promise<string | null> {
  return (await redis().get<string>(k(`connect:${phone}`))) ?? null;
}

export interface Connection {
  user_id: string;
  access_token: string;
  refresh_token: string;
  /** Unix ms when access_token stops working. */
  expires_at: number;
}

/** A verified connection, kept for 30 days of inactivity. */
export async function saveConnection(phone: string, c: Connection) {
  await redis().set(k(`user:${phone}`), c, { ex: 30 * DAY });
}

export async function connectionFor(phone: string): Promise<Connection | null> {
  return (await redis().get<Connection>(k(`user:${phone}`))) ?? null;
}

export async function forgetConnection(phone: string) {
  await redis().del(k(`user:${phone}`));
}

// ── Purchase catalog ─────────────────────────────────────────────────────

export interface Product {
  name?: string;
  price?: string;
  url?: string;
  id?: string;
  image_url?: string;
}

/** The last product search of a purchase conversation, for turns that do not search again. */
export async function rememberCatalog(conversationId: string, products: Product[]) {
  await redis().set(k(`catalog:${conversationId}`), products, { ex: DAY });
}

export async function catalogFor(conversationId: string): Promise<Product[] | null> {
  return (await redis().get<Product[]>(k(`catalog:${conversationId}`))) ?? null;
}

// ── Pending approvals ────────────────────────────────────────────────────

export interface PendingApproval {
  eveSessionId: string;
  conversationId: string;
  hash: string;
}

/** A confirm that paused for the user's passkey: which conversation to resume when the webhook says approved. */
export async function rememberApproval(authorizationId: string, a: PendingApproval) {
  await redis().set(k(`auth:${authorizationId}`), a, { ex: 20 * 60 });
}

export async function approvalFor(authorizationId: string): Promise<PendingApproval | null> {
  return (await redis().get<PendingApproval>(k(`auth:${authorizationId}`))) ?? null;
}
