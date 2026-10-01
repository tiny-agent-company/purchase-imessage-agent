import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard } from "../lib/agentcard";
import { sendCard } from "../lib/linq";
import { phoneOf, userToken } from "../lib/user";
import { rememberVaultSession } from "../lib/store";

interface VaultSession {
  id: string;
  url: string;
  user_id: string | null;
  expires_at: string;
  poll_interval: number;
  test_mode: boolean;
}

export default defineTool({
  description:
    "Text the user a link to store a card in the Agentcard Vault, the card buy pays with. For a NEW user this is the first step and the whole sign-up: the open link enrolls them with a passkey, no code, and when the card lands the agent is connected to them automatically (a webhook says so). For a connected user the link is bound to their account. Refuses (returning the cards) when the connected user already has cards, unless `force` is set because the user wants to add another.",
  inputSchema: z.object({
    force: z.boolean().optional().describe("Send a link even though the user already has cards: only when they asked to add or replace one"),
  }),
  label: { start: () => "Text a Vault link" },
  async execute({ force }, ctx) {
    const phone = await phoneOf(ctx);
    // Bind the link to the connected user, so the card lands on the account
    // /buy runs as. An open link would enroll a separate, contactless user.
    const conn = await userToken(phone);
    if (conn && !force) {
      // A returning user is never sent through enrollment twice.
      const r = await agentcard<{ data?: { id: string; brand?: string; last4?: string }[] }>(
        "GET",
        `/api/v2/vault_cards?user_id=${encodeURIComponent(conn.user_id)}`,
      );
      const cards = (r.data ?? []).map((c) => ({ id: c.id, brand: c.brand, last4: c.last4 }));
      if (cards.length) return { link_sent: false, already_has_cards: cards, next: "No link needed: confirm the cart and the vault pays with one of these." };
    }
    const session = await agentcard<VaultSession>(
      "POST",
      "/api/v2/vault_sessions",
      conn ? { user_id: conn.user_id } : {},
    );
    await rememberVaultSession(session.id, ctx.session.id);
    // The URL rides a native card with our own copy; the card is the whole
    // message, so nothing can be glued to the link (which would fail its
    // verification and land the user on the Vault's sign-in page).
    await sendCard(phone, {
      url: session.url,
      title: conn ? "Add a card" : "Add your card",
      subtitle: "Locked with Face ID or Touch ID.",
      button: "Add card",
    });

    return {
      id: session.id,
      sent_to: phone,
      bound_to_user: conn?.user_id ?? null,
      expires_at: session.expires_at,
      test_mode: session.test_mode,
    };
  },
});
