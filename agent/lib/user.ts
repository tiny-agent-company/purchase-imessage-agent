// The user behind the current conversation: their phone (from the Linq auth
// context) and a live connection token, refreshed when it is about to expire.

import { agentcard, AgentcardError } from "./agentcard";
import { connectionFor, forgetConnection, saveConnection, type Connection } from "./store";

/** The E.164 number the current message came from, from the Linq channel's auth. */
export function phoneOf(ctx: { session: { auth: { current: { attributes?: Record<string, unknown> } | null } } }): string {
  const phone = ctx.session.auth.current?.attributes?.user_name;
  if (typeof phone !== "string" || !phone) throw new Error("No phone number on this conversation");
  return phone;
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
