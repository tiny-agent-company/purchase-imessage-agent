// The user behind the current conversation: their phone (from the Linq auth
// context) and a live connection token, refreshed when it is about to expire.

import { agentcard, AgentcardError } from "./agentcard";
import { connectionFor, firstTime, forgetConnection, phoneForSession, rememberPhone, saveConnection, unmark, type Connection } from "./store";

/**
 * The E.164 number of the user in this conversation. A text from them carries
 * it in the Linq channel's auth; a turn that an Agentcard webhook woke (card
 * stored, purchase approved) carries no Linq auth at all, so the number is
 * remembered per eve session on every text and read back on those turns.
 */
export async function phoneOf(ctx: { session: { id: string; auth: { current: { attributes?: Record<string, unknown> } | null } } }): Promise<string> {
  const phone = ctx.session.auth.current?.attributes?.user_name;
  if (typeof phone === "string" && phone) {
    await rememberPhone(ctx.session.id, phone).catch(() => undefined);
    return phone;
  }
  const remembered = await phoneForSession(ctx.session.id);
  if (remembered) return remembered;
  throw new Error("No phone number on this conversation");
}

/**
 * A usable access token for this phone's connection, or null when the user
 * has not connected yet (or the connection was revoked). Refreshes one that
 * is within a minute of expiring.
 */
export async function userToken(phone: string): Promise<Connection | null> {
  const c = await connectionFor(phone);
  if (!c) return null;
  if (c.expires_at > Date.now() + 60_000) return c;

  try {
    const r = await agentcard<{ access_token: string; refresh_token: string; expires_in: number }>(
      "POST",
      "/api/v2/connect/refresh",
      { refresh_token: c.refresh_token },
    );
    const next: Connection = {
      user_id: c.user_id,
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: Date.now() + r.expires_in * 1000,
    };
    await saveConnection(phone, next);
    return next;
  } catch (e) {
    // A dead refresh token means the connection was revoked: start over.
    if (e instanceof AgentcardError && (e.status === 401 || e.status === 403 || e.status === 400)) {
      await forgetConnection(phone);
      return null;
    }
    throw e;
  }
}

/**
 * The no-code connection. A user who stores a card through an OPEN Vault link
 * (no user_id on the session) is enrolled by the Vault itself: no account, no
 * code. Once the session is linked, the organization exchanges it once for the
 * same access/refresh pair connect/verify returns, and /buy runs as them.
 *
 * `needs_code`: the link proved access to the vault, not to the account (the
 * user signed in to an Agentcard account that already existed), so the code
 * flow (connect_user + verify_code) is the way in. `skipped`: already connected,
 * or another event beat this one to the exchange.
 */
export async function connectFromVaultSession(
  vaultSessionId: string,
  phone: string,
): Promise<"connected" | "needs_code" | "skipped" | "failed"> {
  if (await connectionFor(phone)) return "skipped";
  // One exchange per session: a second call is refused (410 already_exchanged).
  const key = `exchanged:${vaultSessionId}`;
  if (!(await firstTime(key))) return "skipped";
  try {
    const c = await agentcard<{ access_token: string; refresh_token: string; expires_in: number; user: { id: string } }>(
      "POST",
      `/api/v2/vault_sessions/${encodeURIComponent(vaultSessionId)}/exchange`,
    );
    await saveConnection(phone, {
      user_id: c.user.id,
      access_token: c.access_token,
      refresh_token: c.refresh_token,
      expires_at: Date.now() + c.expires_in * 1000,
    });
    await agentcard("POST", "/api/v2/connect/consent", { user_id: c.user.id }).catch(() => undefined);
    return "connected";
  } catch (e) {
    const code = e instanceof AgentcardError && typeof e.body === "object" && e.body
      ? (e.body as { error?: { code?: string } }).error?.code
      : undefined;
    if (code === "account_verification_required") return "needs_code";
    // not_linked (the event raced the link) or a blip: let the next event try again.
    await unmark(key);
    return "failed";
  }
}
