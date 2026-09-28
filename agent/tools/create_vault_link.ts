import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard } from "../lib/agentcard";
import { sendText } from "../lib/linq";
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
    "Create an Agentcard Vault session and text its link to the user as a separate message. The user opens it, enters their card once, and locks it with a passkey. Returns the session id to check later. One link per user per enrollment.",
  inputSchema: z.object({
    phone: z
      .string()
      .optional()
      .describe("E.164 number to text. Leave empty to use the number the current message came from."),
  }),
  label: { start: () => "Text a Vault link" },
  async execute({ phone }, ctx) {
    const auth = ctx.session.auth.current;
    const to = phone ?? (auth?.attributes?.user_name as string | undefined);
    if (!to) throw new Error("No phone number to text the link to");

    const session = await agentcard<VaultSession>("POST", "/api/v2/vault_sessions", {});
    // So the Agentcard webhook (channels/agentcard.ts) can wake this
    // conversation up when the card lands.
    await rememberVaultSession(session.id, ctx.session.id);
    // The URL is the whole message: a link with anything glued to it fails
    // verification and lands the user on the Vault's sign-in page.
    await sendText(to, session.url);

    return {
      id: session.id,
      sent_to: to,
      expires_at: session.expires_at,
      test_mode: session.test_mode,
    };
  },
});
