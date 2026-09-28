import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard } from "../lib/agentcard";
import { sendText } from "../lib/linq";
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
    "Text the user a link to store a card in the Agentcard Vault, the card buy pays with. For a connected user the link is bound to their account (they confirm a code on the page); otherwise it is an open link that enrolls a new vault. Returns the session id to check later.",
  inputSchema: z.object({}),
  label: { start: () => "Text a Vault link" },
  async execute(_input, ctx) {
    const phone = phoneOf(ctx);
    // Bind the link to the connected user, so the card lands on the account
    // /buy runs as. An open link would enroll a separate, contactless user.
    const conn = await userToken(phone);
    const session = await agentcard<VaultSession>(
      "POST",
      "/api/v2/vault_sessions",
      conn ? { user_id: conn.user_id } : {},
    );
    await rememberVaultSession(session.id, ctx.session.id);
    // The URL is the whole message: a link with anything glued to it fails
    // verification and lands the user on the Vault's sign-in page.
    await sendText(phone, session.url);

    return {
      id: session.id,
      sent_to: phone,
      bound_to_user: conn?.user_id ?? null,
      expires_at: session.expires_at,
      test_mode: session.test_mode,
    };
  },
});
