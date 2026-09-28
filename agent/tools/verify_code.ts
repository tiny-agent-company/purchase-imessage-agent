import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard, AgentcardError } from "../lib/agentcard";
import { phoneOf } from "../lib/user";
import { connectAttemptFor, saveConnection } from "../lib/store";

export default defineTool({
  description:
    "Finish connecting the user: pass the six-digit code they texted back. On success the connection is stored and buy works from then on. Returns wrong_code when the code did not match, and no_attempt when connect_user was never called or its code expired.",
  inputSchema: z.object({
    code: z.string().regex(/^\d{6}$/).describe("The six-digit code the user sent"),
  }),
  label: { start: () => "Verify the sign-in code" },
  async execute({ code }, ctx) {
    const phone = phoneOf(ctx);
    const connectId = await connectAttemptFor(phone);
    if (!connectId) return { ok: false, reason: "no_attempt" };

    let verified: { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };
    try {
      verified = await agentcard("POST", "/api/v2/connect/verify", { connect_id: connectId, code });
    } catch (e) {
      if (e instanceof AgentcardError && (e.status === 400 || e.status === 401)) return { ok: false, reason: "wrong_code" };
      throw e;
    }

    await saveConnection(phone, {
      user_id: verified.user.id,
      access_token: verified.access_token,
      refresh_token: verified.refresh_token,
      expires_at: Date.now() + verified.expires_in * 1000,
    });
    // Recorded once per user before any purchase; harmless on repeat.
    await agentcard("POST", "/api/v2/connect/consent", { user_id: verified.user.id });

    return { ok: true, user_id: verified.user.id };
  },
});
