import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcard, isSandbox } from "../lib/agentcard";
import { phoneOf } from "../lib/user";
import { connectionFor, rememberConnectAttempt } from "../lib/store";

// Step one of buying: Agentcard texts the user a one-time code, they text it
// back here, and verify_code turns that into the connection every /buy call
// runs as. Once per user, then remembered for 30 days.

export default defineTool({
  description:
    "The fallback way to connect a user: only when the Vault link could not connect them because their Agentcard account already existed (the webhook says so), or when they say they already have an account. Agentcard sends a six-digit code to the number this conversation is with (or to an email address, if the user gives one because the text never arrived); the user sends it back and you call verify_code. Returns already_connected when there is nothing to do.",
  inputSchema: z.object({
    email: z
      .string()
      .email()
      .optional()
      .describe("Send the code to this email instead of texting the user's number. Only when the user asks for it or says the text never arrived."),
  }),
  label: { start: ({ email }) => (email ? "Email the user a sign-in code" : "Text the user a sign-in code") },
  async execute({ email }, ctx) {
    const phone = await phoneOf(ctx);
    if (await connectionFor(phone)) return { already_connected: true };

    const attempt = await agentcard<{ id: string; channel: string; expires_at: string }>(
      "POST",
      "/api/v2/connect/start",
      email ? { email } : { phone },
    );
    await rememberConnectAttempt(phone, attempt.id);

    return {
      already_connected: false,
      sent_to: email ?? phone,
      channel: attempt.channel,
      expires_at: attempt.expires_at,
      // Sandbox never sends a real text; the code is fixed so anyone can test.
      ...(isSandbox() ? { sandbox_code: "111111", note: "Sandbox: no text is sent. Tell the user the code is 111111." } : {}),
    };
  },
});
