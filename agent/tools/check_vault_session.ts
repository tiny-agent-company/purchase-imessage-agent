import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard } from "../lib/agentcard";

interface VaultSession {
  id: string;
  status: "pending" | "linked" | "expired";
  user_id: string | null;
}

export default defineTool({
  description:
    "Read a Vault session by its id (the `id` from create_vault_link, never the token in the url). Returns `linked` with the user_id once the user has stored a card, `pending` while they are still on the page, or `expired` if the link died unused.",
  inputSchema: z.object({
    session_id: z.string().min(1).describe("The vault session id, e.g. vs_2q9d1x8f3k2m4t7w"),
  }),
  label: { start: ({ session_id }) => `Check Vault session ${session_id}` },
  async execute({ session_id }) {
    const session = await agentcard<VaultSession>(
      "GET",
      `/api/v2/vault_sessions/${encodeURIComponent(session_id)}`,
    );
    return { id: session.id, status: session.status, user_id: session.user_id };
  },
});
