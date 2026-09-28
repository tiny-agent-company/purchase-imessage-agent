import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard } from "../lib/agentcard";
import { phoneOf, userToken } from "../lib/user";

// The cards the connected user already keeps in the Vault. Display fields only:
// brand, last four, expiry. Check this before ever sending an add-a-card link;
// a returning user is never sent through enrollment twice.

export default defineTool({
  description:
    "List the cards the connected user already has in the Agentcard Vault (brand, last4, expiry). Call this before create_vault_link: if any card is listed, the user does not need a link and a confirm with the vault pays with it. Returns not_connected when the user has not connected yet.",
  inputSchema: z.object({}),
  label: { start: () => "Check the user's cards" },
  async execute(_input, ctx) {
    const conn = await userToken(await phoneOf(ctx));
    if (!conn) return { status: "not_connected" };
    const r = await agentcard<{ data?: { id: string; brand?: string; last4?: string; exp_month?: number; exp_year?: number }[] }>(
      "GET",
      `/api/v2/vault_cards?user_id=${encodeURIComponent(conn.user_id)}`,
    );
    const cards = (r.data ?? []).map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, expires: c.exp_month && c.exp_year ? `${c.exp_month}/${c.exp_year}` : undefined }));
    return { status: "ok", count: cards.length, cards };
  },
});
