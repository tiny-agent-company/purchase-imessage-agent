import { defaultLinqAuth, linqChannel } from "eve/channels/linq";

// Linq delivers every inbound iMessage/SMS to POST /eve/v1/linq on this
// deployment. eve verifies the Standard Webhooks signature with the signing
// secret and keeps one durable session per Linq conversation.
export default linqChannel({
  credentials: {
    apiKey: process.env.LINQ_API_KEY!,
    signingSecret: process.env.LINQ_WEBHOOK_SECRET!,
  },
  onMessage(_ctx, message) {
    if (message.author.isBot) return null;
    // The default auth carries the sender's phone number as `user_name`;
    // tools read it from ctx.session.auth to text the user directly.
    return { auth: defaultLinqAuth(message) };
  },
});
