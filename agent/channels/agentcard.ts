import { createHmac, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { agentcard } from "../lib/agentcard";
import { approvalFor, eveSessionFor, firstTime, mark } from "../lib/store";

// Agentcard delivers webhooks here (POST /agentcard/webhooks). When a user
// finishes the Vault link, the event names the vault session; the store maps
// it back to the iMessage conversation that sent the link, and the agent gets
// a message to relay. Register the endpoint with
// POST /api/v2/webhook_endpoints and store its secret as
// AGENTCARD_WEBHOOK_SECRET.

interface Envelope {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: Record<string, unknown>;
}

/** `AgentCard-Signature: t=<unix>,v1=<hex>`; v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). */
function verify(header: string | null, rawBody: string, secret: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const given = parts.v1;
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

const WEBHOOK_AUTH = {
  authenticator: "agentcard-webhook",
  issuer: "agentcard",
  principalType: "service",
  principalId: "agentcard",
  attributes: {},
} as const;

export default defineChannel({
  routes: [
    POST("/agentcard/webhooks", async (request, { attachSession, waitUntil }) => {
      const secret = process.env.AGENTCARD_WEBHOOK_SECRET;
      if (!secret) return new Response("AGENTCARD_WEBHOOK_SECRET is not set", { status: 500 });

      const raw = await request.text();
      if (!verify(request.headers.get("agentcard-signature"), raw, secret)) {
        return new Response("invalid signature", { status: 401 });
      }

      let event: Envelope;
      try {
        event = JSON.parse(raw) as Envelope;
      } catch {
        return new Response("bad json", { status: 400 });
      }

      // At-least-once delivery: act on each event id once.
      if (!(await firstTime(`evt:${event.id}`))) return new Response("ok");

      // A checkout approval resumes the purchase that paused for it.
      if (event.type.startsWith("checkout_authorization.")) {
        const authId = String(event.data.authorization_id ?? "");
        const pending = authId ? await approvalFor(authId) : null;
        if (!pending) return new Response("ok"); // not one of this agent's confirms
        const text = approvalNote(event, pending);
        if (text) waitUntil(attachSession(pending.eveSessionId).send(text, { auth: WEBHOOK_AUTH }));
        return new Response("ok");
      }

      const vs = String(event.data.vault_session_id ?? "");
      const sessionId = vs ? await eveSessionFor(vs) : null;
      if (!sessionId) return new Response("ok"); // a link this agent did not send, or one that expired

      // Reply 200 now; the agent turn runs after the response is sent.
      waitUntil(
        (async () => {
          const note = await describe(event);
          if (!note) return;
          // A session_linked notice waits, so a card_stored that follows it
          // speaks first and names the new card; card_stored then marks the
          // link as announced so the delayed unlock notice stays quiet.
          if (note.delayMs) await new Promise((r) => setTimeout(r, note.delayMs));
          if (!(await firstTime(note.once))) return;
          if (note.settles) await mark(note.settles);
          await attachSession(sessionId).send(note.text, { auth: WEBHOOK_AUTH });
        })(),
      );
      return new Response("ok");
    }),
  ],
});

/**
 * The line the agent receives, or null when the event needs no message.
 *
 * Two events can describe one visit. `vault.session_linked` fires the moment
 * the passkey ceremony binds the user; `vault.card_stored` fires when a card
 * lands, in practice 10 to 20 seconds later. A user who only unlocks an
 * existing vault produces the first and never the second, so the first is
 * worth a message; but a user who then stores a new card produces both, and
 * the message should name the new card. So session_linked waits (delayMs)
 * and card_stored, when it comes, claims the notice first.
 */
interface Note {
  text: string;
  /** Dedupe key: the notice is sent only the first time this key is seen. */
  once: string;
  /** A key to mark as sent alongside, so a competing notice stays quiet. */
  settles?: string;
  delayMs?: number;
}

async function describe(event: Envelope): Promise<Note | null> {
  const d = event.data;
  const vs = String(d.vault_session_id ?? "");
  if (!vs) return null;

  if (event.type === "vault.card_stored") {
    // Every stored card is news, including a second card added through a
    // link that already announced one. Keyed by card, not by link.
    return {
      once: `notified:card:${d.card_id}`,
      settles: `notified:${vs}`,
      text:
        `[Agentcard] The user finished the Vault link (session ${vs}). Their ${brand(d.brand)} ending in ${d.last4} is stored ` +
        `and their user_id is ${d.user_id}. Tell them their card is set up and you can shop for them now, in one sentence.`,
    };
  }

  if (event.type === "vault.session_linked") {
    const cards = await agentcard<{ data?: { brand?: string; last4?: string; created_at?: string }[] }>(
      "GET",
      `/api/v2/vault_cards?user_id=${encodeURIComponent(String(d.user_id))}`,
    );
    const list = cards.data ?? [];
    if (list.length === 0) return null; // a new user: vault.card_stored follows with the card
    const c = list.slice().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]!;
    return {
      once: `notified:${vs}`,
      delayMs: 30_000,
      text:
        `[Agentcard] The user finished the Vault link (session ${vs}) by unlocking their existing vault. ` +
        `Their ${brand(c.brand)} ending in ${c.last4} is ready and their user_id is ${d.user_id}. ` +
        `Tell them their card is set up and you can shop for them now, in one sentence.`,
    };
  }

  return null;
}

/** What the agent hears when the user acts on an approval link. */
function approvalNote(event: Envelope, p: { conversationId: string; hash: string }): string | null {
  const d = event.data;
  const amount = typeof d.amount_display === "string" ? d.amount_display : "";
  switch (event.type) {
    case "checkout_authorization.approved":
      return (
        `[Agentcard] The user approved the purchase${amount ? ` (${amount})` : ""} with their passkey. ` +
        `Call buy now with confirm "${p.hash}" on conversation "${p.conversationId}" to place the order, then tell them the result. Do not ask them anything first.`
      );
    case "checkout_authorization.declined":
      return `[Agentcard] The user declined the purchase on the approval page${d.reason ? ` (${d.reason})` : ""}. Tell them it was not placed and ask what they would like to do.`;
    case "checkout_authorization.expired":
      return `[Agentcard] The approval link expired before the user approved. Tell them, and offer to send a new one (a new confirm produces one).`;
    default:
      return null;
  }
}

function brand(value: unknown): string {
  const b = String(value ?? "card").toLowerCase();
  return { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" }[b] ?? "card";
}
